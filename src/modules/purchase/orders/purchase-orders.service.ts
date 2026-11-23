import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  PurchaseApprovalAction,
  PurchaseEmailStatus,
  PurchaseOrderSendStatus,
  PurchaseOrderStatus,
  PurchaseOrderType,
  PurchaseRequirementStatus,
  UserAuditAction,
} from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { allowedActions, canApprovePurchase } from './purchase.mapper';
import {
  asDate,
  assertRowVersion,
  audit,
  D,
  day,
  fail,
  money,
  nextNumber,
  PurchaseTx,
  withIdempotency,
} from './purchase.util';
import {
  ApproveDto,
  EmailAttemptListQueryDto,
  PurchaseOrderListQueryDto,
  ReasonDto,
  RejectDto,
  RowVersionDto,
  SavePurchaseOrderDto,
} from './dto/purchase.dto';

const orderInclude = {
  vendor: { select: { vendorId: true, name: true, email: true, phone: true, address: true, city: true, country: true } },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    include: {
      item: { select: { itemId: true, itemCode: true, oldCode: true, description: true } },
      sources: true,
    },
  },
  approvals: { orderBy: { actedAt: 'asc' as const } },
  versions: { orderBy: { version: 'asc' as const } },
  emails: { orderBy: { attemptedAt: 'desc' as const } },
} satisfies Prisma.PurchaseOrderInclude;

type OrderDetail = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

const OPEN_REQUIREMENT = new Set<PurchaseRequirementStatus>([
  PurchaseRequirementStatus.DRAFT,
  PurchaseRequirementStatus.PENDING_REVIEW,
  PurchaseRequirementStatus.APPROVED,
  PurchaseRequirementStatus.PARTIALLY_CONVERTED,
]);

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, query: PurchaseOrderListQueryDto, user: AuthenticatedUser) {
    const company = parseBigIntId(companyId, 'companyId');
    const { page, limit, skip } = getPaginationParams(query);
    const search = query.search?.trim();
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId: company,
      ...(query.status ? { status: query.status as PurchaseOrderStatus } : {}),
      ...(query.sendStatus ? { sendStatus: query.sendStatus as PurchaseOrderSendStatus } : {}),
      ...(query.poType ? { poType: query.poType as PurchaseOrderType } : {}),
      ...(query.vendorId ? { vendorId: parseBigIntId(query.vendorId, 'vendorId') } : {}),
      ...(query.buyerId ? { buyerId: parseBigIntId(query.buyerId, 'buyerId') } : {}),
      ...(query.warehouseId ? { warehouseId: parseBigIntId(query.warehouseId, 'warehouseId') } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            poDate: {
              ...(query.dateFrom ? { gte: asDate(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: asDate(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { poNo: { contains: search, mode: 'insensitive' } },
              { vendor: { name: { contains: search, mode: 'insensitive' } } },
              { lines: { some: { item: { itemCode: { contains: search, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    if (query.approvalQueue === 'mine') {
      Object.assign(where, await this.approvalQueueWhere(company, user));
    }
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { vendor: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return serialize(toPaginatedResult(rows.map((row) => ({
      purchaseOrderId: row.purchaseOrderId.toString(),
      poNo: row.poNo,
      poType: row.poType,
      vendorId: row.vendorId.toString(),
      vendorName: row.vendor.name,
      status: row.status,
      sendStatus: row.sendStatus,
      grandTotal: money(row.grandTotal),
    })), total, page, limit));
  }

  async detail(companyId: string, id: string, user: AuthenticatedUser) {
    const order = await this.load(companyId, id);
    const settings = await this.settings(parseBigIntId(companyId, 'companyId'));
    return this.toDetail(order, user, settings.selfApprovalAllowed);
  }

  async create(companyId: string, dto: SavePurchaseOrderDto, user: AuthenticatedUser) {
    const company = parseBigIntId(companyId, 'companyId');
    const actor = parseBigIntId(user.sub, 'userId');
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertHeader(tx, company, dto);
      const totals = this.priceLines(dto);
      const order = await tx.purchaseOrder.create({
        data: {
          companyId: company,
          poNo: await nextNumber(tx, company, 'PO'),
          poType: dto.poType,
          vendorId: parseBigIntId(dto.vendorId, 'vendorId'),
          poDate: asDate(dto.poDate),
          currencyId: parseBigIntId(dto.currencyId, 'currencyId'),
          paymentTermId: parseBigIntId(dto.paymentTermId, 'paymentTermId'),
          deliveryDate: asDate(dto.deliveryDate),
          warehouseId: parseBigIntId(dto.warehouseId, 'warehouseId'),
          buyerId: actor,
          vendorReference: dto.vendorReference,
          internalNotes: dto.internalNotes,
          supplierNotes: dto.supplierNotes,
          reason: dto.reason,
          ...totals.header,
          status: PurchaseOrderStatus.DRAFT,
          createdBy: actor,
        },
      });
      await this.writeLines(tx, company, order.purchaseOrderId, dto, false);
      await audit(tx, company, actor, UserAuditAction.create, 'purchase_order', order.purchaseOrderId, { poNo: order.poNo });
      return order.purchaseOrderId;
    });
    return this.detail(companyId, created.toString(), user);
  }

  async update(companyId: string, id: string, dto: SavePurchaseOrderDto, user: AuthenticatedUser) {
    if (dto.rowVersion == null) fail('rowVersion is required', 'ROW_VERSION_CONFLICT', HttpStatus.CONFLICT);
    const company = parseBigIntId(companyId, 'companyId');
    const orderId = parseBigIntId(id, 'purchaseOrderId');
    const actor = parseBigIntId(user.sub, 'userId');
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOrder(tx, company, orderId);
      if (current.status !== PurchaseOrderStatus.DRAFT && current.status !== PurchaseOrderStatus.REJECTED) {
        fail('Only a draft or rejected purchase order can be edited', 'PO_NOT_DRAFT');
      }
      assertRowVersion(current.rowVersion, dto.rowVersion!);
      await this.releaseSources(tx, orderId);
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: orderId } });
      await this.assertHeader(tx, company, dto);
      const totals = this.priceLines(dto);
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: orderId },
        data: {
          poType: dto.poType,
          vendorId: parseBigIntId(dto.vendorId, 'vendorId'),
          poDate: asDate(dto.poDate),
          currencyId: parseBigIntId(dto.currencyId, 'currencyId'),
          paymentTermId: parseBigIntId(dto.paymentTermId, 'paymentTermId'),
          deliveryDate: asDate(dto.deliveryDate),
          warehouseId: parseBigIntId(dto.warehouseId, 'warehouseId'),
          vendorReference: dto.vendorReference,
          internalNotes: dto.internalNotes,
          supplierNotes: dto.supplierNotes,
          reason: dto.reason,
          ...totals.header,
          updatedBy: actor,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.writeLines(tx, company, orderId, dto, true);
    });
    return this.detail(companyId, id, user);
  }

  submit(companyId: string, id: string, dto: RowVersionDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'submit', dto, async (tx, order, actor) => {
      this.assertEditable(order);
      assertRowVersion(order.rowVersion, dto.rowVersion);
      await this.addApproval(tx, order, actor, PurchaseApprovalAction.SUBMIT, null);
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: { status: PurchaseOrderStatus.PENDING_APPROVAL, submittedAt: new Date(), updatedBy: actor, updatedAt: new Date(), rowVersion: { increment: 1 } },
      });
    });
  }

  withdraw(companyId: string, id: string, dto: RowVersionDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'withdraw', dto, async (tx, order, actor) => {
      if (order.status !== PurchaseOrderStatus.PENDING_APPROVAL) fail('Only a purchase order waiting for approval can be withdrawn', 'PO_NOT_PENDING');
      assertRowVersion(order.rowVersion, dto.rowVersion);
      await this.addApproval(tx, order, actor, PurchaseApprovalAction.WITHDRAW, null);
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: { status: PurchaseOrderStatus.DRAFT, updatedBy: actor, updatedAt: new Date(), rowVersion: { increment: 1 } },
      });
    });
  }

  approve(companyId: string, id: string, dto: ApproveDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'approve', dto, async (tx, order, actor) => {
      if (order.status !== PurchaseOrderStatus.PENDING_APPROVAL) fail('This purchase order is not waiting for approval', 'PO_NOT_PENDING');
      assertRowVersion(order.rowVersion, dto.rowVersion);
      const settings = await this.settings(order.companyId, tx);
      const isBuyer = order.buyerId === actor || order.createdBy === actor;
      if (isBuyer && !settings.selfApprovalAllowed) fail('You cannot approve your own purchase order', 'PO_SELF_APPROVAL', HttpStatus.FORBIDDEN);
      if (!canApprovePurchase(user)) fail('You cannot approve this purchase order', 'PO_NO_AUTHORITY', HttpStatus.FORBIDDEN);
      await this.assertAuthority(tx, order, actor);
      await this.addApproval(tx, order, actor, PurchaseApprovalAction.APPROVE, dto.comment ?? null);
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: { status: PurchaseOrderStatus.APPROVED, approvedAt: new Date(), approvedBy: actor, updatedBy: actor, updatedAt: new Date(), rowVersion: { increment: 1 } },
      });
    });
  }

  reject(companyId: string, id: string, dto: RejectDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'reject', dto, async (tx, order, actor) => {
      if (order.status !== PurchaseOrderStatus.PENDING_APPROVAL) fail('This purchase order is not waiting for approval', 'PO_NOT_PENDING');
      assertRowVersion(order.rowVersion, dto.rowVersion);
      if (!canApprovePurchase(user)) fail('You cannot reject this purchase order', 'PO_NO_AUTHORITY', HttpStatus.FORBIDDEN);
      await this.addApproval(tx, order, actor, PurchaseApprovalAction.REJECT, dto.comment);
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: { status: PurchaseOrderStatus.REJECTED, updatedBy: actor, updatedAt: new Date(), rowVersion: { increment: 1 } },
      });
    });
  }

  amend(companyId: string, id: string, dto: RowVersionDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'amend', dto, async (tx, order, actor) => {
      if (order.status !== PurchaseOrderStatus.APPROVED) fail('Only an approved purchase order can be amended', 'PO_NOT_APPROVED');
      assertRowVersion(order.rowVersion, dto.rowVersion);
      await this.snapshot(tx, order, actor);
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: {
          version: { increment: 1 },
          status: PurchaseOrderStatus.DRAFT,
          sendStatus: PurchaseOrderSendStatus.NOT_SENT,
          approvedAt: null,
          approvedBy: null,
          updatedBy: actor,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
    });
  }

  issue(companyId: string, id: string, dto: RowVersionDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'issue', dto, async (tx, order, actor) => {
      if (order.status !== PurchaseOrderStatus.APPROVED) fail('Issue is allowed only after approval', 'PO_NOT_APPROVED');
      assertRowVersion(order.rowVersion, dto.rowVersion);
      const vendor = await tx.vendor.findFirst({ where: { vendorId: order.vendorId }, select: { name: true, email: true, phone: true, address: true, city: true, country: true } });
      const term = order.paymentTermId
        ? await tx.$queryRaw<{ code: string; name: string; days: number }[]>`SELECT code, name, days FROM payment_terms WHERE payment_term_id = ${order.paymentTermId}`
        : [];
      await this.snapshot(tx, order, actor);
      const recipient = vendor?.email?.trim() || '';
      const failed = !recipient;
      await tx.purchaseEmailAttempt.create({
        data: {
          companyId: order.companyId,
          purchaseOrderId: order.purchaseOrderId,
          version: order.version,
          recipient: recipient || 'missing',
          status: failed ? PurchaseEmailStatus.FAILED : PurchaseEmailStatus.QUEUED,
          errorMessage: failed ? 'Vendor has no email address' : null,
          sentBy: actor,
        },
      });
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: {
          status: PurchaseOrderStatus.SENT,
          sendStatus: failed ? PurchaseOrderSendStatus.FAILED : PurchaseOrderSendStatus.QUEUED,
          vendorSnapshot: vendor ?? Prisma.JsonNull,
          paymentTermSnapshot: term[0] ?? Prisma.JsonNull,
          updatedBy: actor,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
    });
  }

  resend(companyId: string, id: string, dto: RowVersionDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'resend', dto, async (tx, order, actor) => {
      if (order.status === PurchaseOrderStatus.DRAFT || order.status === PurchaseOrderStatus.PENDING_APPROVAL || order.status === PurchaseOrderStatus.CANCELLED) {
        fail('This purchase order has not been issued', 'PO_NOT_APPROVED');
      }
      assertRowVersion(order.rowVersion, dto.rowVersion);
      const vendor = await tx.vendor.findFirst({ where: { vendorId: order.vendorId }, select: { email: true } });
      const recipient = vendor?.email?.trim() || '';
      await tx.purchaseEmailAttempt.create({
        data: {
          companyId: order.companyId,
          purchaseOrderId: order.purchaseOrderId,
          version: order.version,
          recipient: recipient || 'missing',
          status: recipient ? PurchaseEmailStatus.QUEUED : PurchaseEmailStatus.FAILED,
          errorMessage: recipient ? null : 'Vendor has no email address',
          sentBy: actor,
        },
      });
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: {
          sendStatus: recipient ? PurchaseOrderSendStatus.QUEUED : PurchaseOrderSendStatus.FAILED,
          updatedBy: actor,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
    });
  }

  close(companyId: string, id: string, dto: ReasonDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'close', dto, async (tx, order, actor) => {
      if (order.status !== PurchaseOrderStatus.SENT && order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED && order.status !== PurchaseOrderStatus.FULLY_RECEIVED) {
        fail('This purchase order cannot be closed', 'PO_NOT_APPROVED');
      }
      assertRowVersion(order.rowVersion, dto.rowVersion);
      const open = await tx.purchaseOrderLine.aggregate({ where: { purchaseOrderId: order.purchaseOrderId }, _sum: { outstandingQty: true } });
      if (D(open._sum.outstandingQty ?? 0).greaterThan(0) && !dto.reason) fail('A reason is required to close with quantity still open', 'PO_OPEN_QTY_ON_CLOSE');
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: { status: PurchaseOrderStatus.CLOSED, closedAt: new Date(), closeReason: dto.reason, updatedBy: actor, updatedAt: new Date(), rowVersion: { increment: 1 } },
      });
    });
  }

  cancel(companyId: string, id: string, dto: ReasonDto, user: AuthenticatedUser, key?: string) {
    return this.transition(companyId, id, user, key, 'cancel', dto, async (tx, order, actor) => {
      if (order.status !== PurchaseOrderStatus.DRAFT && order.status !== PurchaseOrderStatus.REJECTED && order.status !== PurchaseOrderStatus.APPROVED) {
        fail('This purchase order cannot be cancelled', 'PO_CANCELLED');
      }
      assertRowVersion(order.rowVersion, dto.rowVersion);
      const received = await tx.purchaseOrderLine.aggregate({ where: { purchaseOrderId: order.purchaseOrderId }, _sum: { receivedQty: true } });
      if (D(received._sum.receivedQty ?? 0).greaterThan(0)) fail('A purchase order with receipts cannot be cancelled', 'PO_CANCELLED');
      await this.releaseSources(tx, order.purchaseOrderId);
      await tx.purchaseOrder.update({
        where: { purchaseOrderId: order.purchaseOrderId },
        data: { status: PurchaseOrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: dto.reason, updatedBy: actor, updatedAt: new Date(), rowVersion: { increment: 1 } },
      });
    });
  }

  async history(companyId: string, id: string) {
    const order = await this.load(companyId, id);
    return {
      approvals: order.approvals.map((row) => ({
        purchaseOrderApprovalId: row.purchaseOrderApprovalId.toString(),
        version: row.version,
        action: row.action,
        userId: row.userId.toString(),
        comment: row.comment ?? '',
        actedAt: row.actedAt.toISOString(),
      })),
      versions: order.versions.map((row) => ({
        purchaseOrderVersionId: row.purchaseOrderVersionId.toString(),
        version: row.version,
        snapshot: row.snapshot,
        pdfFileId: row.pdfFileId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async emailAttempts(companyId: string, query: EmailAttemptListQueryDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.PurchaseEmailAttemptWhereInput = {
      companyId: company,
      ...(query.status ? { status: query.status as PurchaseEmailStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseEmailAttempt.findMany({
        where,
        include: { purchaseOrder: { select: { poNo: true, vendor: { select: { name: true } } } } },
        orderBy: { attemptedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.purchaseEmailAttempt.count({ where }),
    ]);
    return serialize(toPaginatedResult(rows.map((row) => ({
      purchaseEmailAttemptId: row.purchaseEmailAttemptId.toString(),
      purchaseOrderId: row.purchaseOrderId.toString(),
      poNo: row.purchaseOrder.poNo,
      vendorName: row.purchaseOrder.vendor.name,
      recipient: row.recipient,
      version: row.version,
      status: row.status,
      errorMessage: row.errorMessage ?? '',
      retryCount: row.retryCount,
      attemptedAt: row.attemptedAt.toISOString(),
    })), total, page, limit));
  }

  private async transition(
    companyId: string,
    id: string,
    user: AuthenticatedUser,
    key: string | undefined,
    action: string,
    body: unknown,
    run: (tx: PurchaseTx, order: Prisma.PurchaseOrderGetPayload<object>, actor: bigint) => Promise<void>,
  ) {
    const company = parseBigIntId(companyId, 'companyId');
    const orderId = parseBigIntId(id, 'purchaseOrderId');
    const actor = parseBigIntId(user.sub, 'userId');
    await withIdempotency(this.prisma, company, actor, `POST /purchase-orders/${id}/${action}`, key, body, async (tx) => {
      const order = await this.lockOrder(tx, company, orderId);
      await run(tx, order, actor);
      return { purchaseOrderId: id, action };
    });
    return this.detail(companyId, id, user);
  }

  private async load(companyId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { companyId: parseBigIntId(companyId, 'companyId'), purchaseOrderId: parseBigIntId(id, 'purchaseOrderId') },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Purchase order');
    return order;
  }

  private async lockOrder(tx: PurchaseTx, companyId: bigint, orderId: bigint) {
    const rows = await tx.$queryRaw<{ purchase_order_id: bigint }[]>`
      SELECT purchase_order_id FROM purchase_orders
      WHERE company_id = ${companyId} AND purchase_order_id = ${orderId}
      FOR UPDATE
    `;
    if (!rows[0]) throw new NotFoundException('Purchase order');
    const order = await tx.purchaseOrder.findFirst({ where: { purchaseOrderId: orderId, companyId } });
    if (!order) throw new NotFoundException('Purchase order');
    return order;
  }

  private assertEditable(order: { status: PurchaseOrderStatus }) {
    if (order.status !== PurchaseOrderStatus.DRAFT && order.status !== PurchaseOrderStatus.REJECTED) {
      fail('Only a draft or rejected purchase order can be submitted', 'PO_NOT_DRAFT');
    }
  }

  private async assertHeader(tx: PurchaseTx, companyId: bigint, dto: SavePurchaseOrderDto) {
    const vendor = await tx.vendor.findFirst({ where: { vendorId: parseBigIntId(dto.vendorId, 'vendorId'), companyId, deletedAt: null, isActive: true }, select: { vendorId: true } });
    if (!vendor) fail('Vendor was not found', 'VENDOR_NOT_FOUND', HttpStatus.NOT_FOUND);
    const warehouse = await tx.warehouse.findFirst({ where: { warehouseId: parseBigIntId(dto.warehouseId, 'warehouseId'), companyId, deletedAt: null }, select: { warehouseId: true } });
    if (!warehouse) fail('Warehouse was not found', 'WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const currency = await tx.currency.findFirst({ where: { currencyId: parseBigIntId(dto.currencyId, 'currencyId'), deletedAt: null }, select: { currencyId: true } });
    if (!currency) fail('Currency was not found', 'CURRENCY_NOT_FOUND', HttpStatus.NOT_FOUND);
    const term = await tx.$queryRaw<{ payment_term_id: bigint }[]>`
      SELECT payment_term_id FROM payment_terms
      WHERE company_id = ${companyId} AND payment_term_id = ${parseBigIntId(dto.paymentTermId, 'paymentTermId')} AND deleted_at IS NULL
    `;
    if (!term[0]) fail('Payment term was not found', 'PAYMENT_TERM_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  private priceLines(dto: SavePurchaseOrderDto) {
    let subtotal = D(0);
    let discount = D(0);
    let tax = D(0);
    const lines = dto.lines.map((line) => {
      const ordered = D(line.orderedQty);
      const price = D(line.unitPrice);
      const discountAmount = D(line.discountAmount ?? 0);
      const net = ordered.mul(price).minus(discountAmount);
      const taxAmount = net.mul(D(line.taxPct)).div(100);
      const gross = net.plus(taxAmount);
      const sourceQty = (line.sources ?? []).reduce((sum, source) => sum.plus(source.qty), D(0));
      if ((line.sources?.length ?? 0) > 0 && !ordered.equals(sourceQty) && !line.varianceReason) {
        fail('A reason is required when the ordered quantity differs from the requirement', 'PO_VARIANCE_REASON_REQUIRED');
      }
      subtotal = subtotal.plus(ordered.mul(price));
      discount = discount.plus(discountAmount);
      tax = tax.plus(taxAmount);
      return { net, taxAmount, gross, originalQty: (line.sources?.length ?? 0) > 0 ? sourceQty : null };
    });
    return {
      lines,
      header: {
        subtotal,
        discountAmount: discount,
        taxAmount: tax,
        freightAmount: D(0),
        otherAmount: D(0),
        grandTotal: subtotal.minus(discount).plus(tax),
      },
    };
  }

  private async writeLines(tx: PurchaseTx, companyId: bigint, orderId: bigint, dto: SavePurchaseOrderDto, replacing: boolean) {
    const priced = this.priceLines(dto);
    const needed = new Map<string, Prisma.Decimal>();
    dto.lines.forEach((line) => {
      for (const source of line.sources ?? []) {
        needed.set(source.purchaseRequirementId, (needed.get(source.purchaseRequirementId) ?? D(0)).plus(source.qty));
      }
    });
    for (const [requirementId, qty] of needed) {
      const id = parseBigIntId(requirementId, 'purchaseRequirementId');
      const locked = await tx.$queryRaw<{ purchase_requirement_id: bigint }[]>`
        SELECT purchase_requirement_id FROM purchase_requirements
        WHERE company_id = ${companyId} AND purchase_requirement_id = ${id}
        FOR UPDATE
      `;
      if (!locked[0]) fail('Purchase requirement was not found', 'PR_NOT_FOUND', HttpStatus.NOT_FOUND);
      const requirement = await tx.purchaseRequirement.findFirst({ where: { purchaseRequirementId: id, companyId } });
      if (!requirement || !OPEN_REQUIREMENT.has(requirement.status)) fail('Purchase requirement is not open', 'PR_NOT_OPEN');
      const open = D(requirement.requiredQty).minus(requirement.convertedQty);
      if (qty.greaterThan(open)) fail('Requirement quantity is already used on another purchase order', 'PR_QTY_EXCEEDED');
      const converted = D(requirement.convertedQty).plus(qty);
      await tx.purchaseRequirement.update({
        where: { purchaseRequirementId: id },
        data: {
          convertedQty: converted,
          status: converted.greaterThanOrEqualTo(requirement.requiredQty)
            ? PurchaseRequirementStatus.FULLY_CONVERTED
            : PurchaseRequirementStatus.PARTIALLY_CONVERTED,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
    }
    for (let index = 0; index < dto.lines.length; index++) {
      const line = dto.lines[index];
      const pricedLine = priced.lines[index];
      const item = await tx.item.findFirst({ where: { itemId: parseBigIntId(line.itemId, 'itemId'), companyId, deletedAt: null }, select: { itemId: true, description: true } });
      if (!item) fail('Item was not found', 'ITEM_NOT_FOUND', HttpStatus.NOT_FOUND);
      const saved = await tx.purchaseOrderLine.create({
        data: {
          companyId,
          purchaseOrderId: orderId,
          lineNo: index + 1,
          itemId: item.itemId,
          description: line.description || item.description,
          uomId: parseBigIntId(line.uomId, 'uomId'),
          orderedQty: D(line.orderedQty),
          originalQty: pricedLine.originalQty,
          unitPrice: D(line.unitPrice),
          discountAmount: D(line.discountAmount ?? 0),
          taxPct: D(line.taxPct),
          netAmount: pricedLine.net,
          taxAmount: pricedLine.taxAmount,
          grossAmount: pricedLine.gross,
          requiredDate: line.requiredDate ? asDate(line.requiredDate) : asDate(dto.deliveryDate),
          warehouseId: parseBigIntId(line.warehouseId, 'warehouseId'),
          outstandingQty: D(line.orderedQty),
          varianceReason: line.varianceReason,
        },
      });
      if (line.sources?.length) {
        await tx.purchaseOrderLineSource.createMany({
          data: line.sources.map((source) => ({
            companyId,
            purchaseOrderLineId: saved.purchaseOrderLineId,
            purchaseRequirementId: parseBigIntId(source.purchaseRequirementId, 'purchaseRequirementId'),
            qty: D(source.qty),
          })),
        });
      }
    }
    void replacing;
  }

  private async releaseSources(tx: PurchaseTx, orderId: bigint) {
    const sources = await tx.purchaseOrderLineSource.findMany({
      where: { line: { purchaseOrderId: orderId } },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const source of sources) {
      const key = source.purchaseRequirementId.toString();
      totals.set(key, (totals.get(key) ?? D(0)).plus(source.qty));
    }
    for (const [requirementId, qty] of totals) {
      const id = BigInt(requirementId);
      const requirement = await tx.purchaseRequirement.findFirst({ where: { purchaseRequirementId: id } });
      if (!requirement) continue;
      const converted = D(requirement.convertedQty).minus(qty);
      const next = converted.lessThanOrEqualTo(0) ? D(0) : converted;
      await tx.purchaseRequirement.update({
        where: { purchaseRequirementId: id },
        data: {
          convertedQty: next,
          status: next.equals(0)
            ? PurchaseRequirementStatus.APPROVED
            : next.greaterThanOrEqualTo(requirement.requiredQty)
              ? PurchaseRequirementStatus.FULLY_CONVERTED
              : PurchaseRequirementStatus.PARTIALLY_CONVERTED,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
    }
  }

  private async addApproval(tx: PurchaseTx, order: { purchaseOrderId: bigint; companyId: bigint; version: number }, actor: bigint, action: PurchaseApprovalAction, comment: string | null) {
    await tx.purchaseOrderApproval.create({
      data: { companyId: order.companyId, purchaseOrderId: order.purchaseOrderId, version: order.version, action, userId: actor, comment },
    });
  }

  private async snapshot(tx: PurchaseTx, order: { purchaseOrderId: bigint; companyId: bigint; version: number }, actor: bigint) {
    const full = await tx.purchaseOrder.findFirst({ where: { purchaseOrderId: order.purchaseOrderId }, include: orderInclude });
    await tx.purchaseOrderVersion.create({
      data: {
        companyId: order.companyId,
        purchaseOrderId: order.purchaseOrderId,
        version: order.version,
        snapshot: serialize(full) as unknown as Prisma.InputJsonValue,
        createdBy: actor,
      },
    });
  }

  private async settings(companyId: bigint, db: PurchaseTx | PrismaService = this.prisma) {
    const row = await db.purchaseSettings.findUnique({ where: { companyId } });
    return { selfApprovalAllowed: row?.selfApprovalAllowed ?? false };
  }

  private async assertAuthority(tx: PurchaseTx, order: { companyId: bigint; poType: PurchaseOrderType; currencyId: bigint; grandTotal: Prisma.Decimal }, actor: bigint) {
    const rules = await tx.purchaseApprovalRule.findMany({ where: { companyId: order.companyId, isActive: true, poType: order.poType, currencyId: order.currencyId } });
    if (rules.length === 0) return;
    const roles = await tx.userRole.findMany({ where: { userId: actor, companyId: order.companyId, isActive: true }, select: { roleId: true } });
    const roleIds = new Set(roles.map((role) => role.roleId.toString()));
    const total = D(order.grandTotal);
    const match = rules.some((rule) =>
      roleIds.has(rule.approverRoleId.toString())
      && total.greaterThanOrEqualTo(rule.amountFrom)
      && (rule.amountTo == null || total.lessThanOrEqualTo(rule.amountTo)),
    );
    if (!match) fail('This amount is outside your approval authority', 'PO_NO_AUTHORITY', HttpStatus.FORBIDDEN);
  }

  private async approvalQueueWhere(companyId: bigint, user: AuthenticatedUser): Promise<Prisma.PurchaseOrderWhereInput> {
    const actor = parseBigIntId(user.sub, 'userId');
    const settings = await this.settings(companyId);
    const roles = await this.prisma.userRole.findMany({ where: { userId: actor, companyId, isActive: true }, select: { roleId: true } });
    const roleIds = roles.map((role) => role.roleId);
    const rules = await this.prisma.purchaseApprovalRule.findMany({
      where: { companyId, isActive: true, ...(roleIds.length ? { approverRoleId: { in: roleIds } } : { approverRoleId: { in: [] } }) },
    });
    const anyRules = await this.prisma.purchaseApprovalRule.count({ where: { companyId, isActive: true } });
    return {
      status: PurchaseOrderStatus.PENDING_APPROVAL,
      ...(settings.selfApprovalAllowed ? {} : { NOT: { buyerId: actor } }),
      ...(anyRules === 0
        ? {}
        : rules.length === 0
          ? { purchaseOrderId: { in: [] } }
          : {
              OR: rules.map((rule) => ({
                poType: rule.poType,
                currencyId: rule.currencyId,
                grandTotal: {
                  gte: rule.amountFrom,
                  ...(rule.amountTo != null ? { lte: rule.amountTo } : {}),
                },
              })),
            }),
    };
  }

  private toDetail(order: OrderDetail, user: AuthenticatedUser, selfApprovalAllowed: boolean) {
    return {
      purchaseOrderId: order.purchaseOrderId.toString(),
      poNo: order.poNo,
      poType: order.poType,
      version: order.version,
      status: order.status,
      sendStatus: order.sendStatus,
      vendorId: order.vendorId.toString(),
      vendorName: order.vendor.name,
      currencyId: order.currencyId.toString(),
      paymentTermId: order.paymentTermId?.toString() ?? null,
      warehouseId: order.warehouseId.toString(),
      buyerId: order.buyerId.toString(),
      poDate: day(order.poDate),
      deliveryDate: day(order.deliveryDate),
      vendorReference: order.vendorReference ?? '',
      internalNotes: order.internalNotes ?? '',
      supplierNotes: order.supplierNotes ?? '',
      reason: order.reason ?? '',
      subtotal: money(order.subtotal),
      discountAmount: money(order.discountAmount),
      taxAmount: money(order.taxAmount),
      freightAmount: money(order.freightAmount),
      otherAmount: money(order.otherAmount),
      grandTotal: money(order.grandTotal),
      rowVersion: order.rowVersion,
      allowedActions: allowedActions({
        status: order.status,
        buyerId: order.buyerId,
        createdBy: order.createdBy,
        user,
        selfApprovalAllowed,
      }),
      lines: order.lines.map((line) => ({
        purchaseOrderLineId: line.purchaseOrderLineId.toString(),
        lineNo: line.lineNo,
        itemId: line.itemId.toString(),
        partNo: line.item.itemCode,
        oldPartNo: line.item.oldCode,
        description: line.description ?? line.item.description,
        uomId: line.uomId?.toString() ?? null,
        orderedQty: money(line.orderedQty),
        originalQty: line.originalQty == null ? null : money(line.originalQty),
        unitPrice: money(line.unitPrice),
        taxPct: D(line.taxPct).toFixed(3),
        discountAmount: money(line.discountAmount),
        netAmount: money(line.netAmount),
        taxAmount: money(line.taxAmount),
        grossAmount: money(line.grossAmount),
        requiredDate: day(line.requiredDate),
        warehouseId: line.warehouseId.toString(),
        receivedQty: money(line.receivedQty),
        acceptedQty: money(line.acceptedQty),
        rejectedQty: money(line.rejectedQty),
        outstandingQty: money(line.outstandingQty),
        varianceReason: line.varianceReason ?? '',
        sources: line.sources.map((source) => ({
          purchaseRequirementId: source.purchaseRequirementId.toString(),
          qty: money(source.qty),
        })),
      })),
    };
  }
}
