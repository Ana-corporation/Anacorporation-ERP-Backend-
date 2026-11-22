import { HttpStatus, Injectable } from '@nestjs/common';
import {
  InventoryDocumentStatus,
  InventoryDocumentType,
  Prisma,
  StockMovementType,
  UserAuditAction,
} from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { InventoryDocumentInput, InventoryDocumentListQueryDto } from './dto/inventory-document.dto';
import { InventoryDocumentDetail, InventoryDocumentsRepository } from './inventory-documents.repository';
import { InventoryLineResolverService, ResolvedInventoryLine } from './inventory-line-resolver.service';
import { StockMovementInput, StockPostingService, stockKey } from './stock-posting.service';
import { SubcontractorLocationService } from './subcontractor-location.service';

export const INVENTORY_DOCUMENT_ERROR_CODES = {
  POSTED_LOCKED: 'INVENTORY_DOCUMENT_POSTED',
  ALREADY_POSTED: 'INVENTORY_DOCUMENT_ALREADY_POSTED',
  INVALID_DATE: 'INVENTORY_INVALID_DATE',
  DEPARTMENT_NOT_FOUND: 'INVENTORY_DEPARTMENT_NOT_FOUND',
  DEFAULT_LOCATION_INVALID: 'INVENTORY_DEFAULT_LOCATION_INVALID',
  ZERO_PRICE: 'OPENING_STOCK_ZERO_PRICE',
  OPENING_EXISTS: 'OPENING_STOCK_ALREADY_EXISTS',
  SERIAL_DUPLICATE: 'SERIAL_DUPLICATE',
  BEFORE_OPENING: 'TRANSACTION_BEFORE_OPENING_STOCK',
} as const;

export const INVENTORY_DOCUMENT_SOURCE = 'INVENTORY_DOCUMENT';

const DOCUMENT_LABEL: Record<InventoryDocumentType, string> = {
  OPENING_STOCK: 'Opening stock',
  MATERIAL_ISSUE: 'Material issue',
  STOCK_ADJUSTMENT: 'Stock adjustment',
  STOCK_TRANSFER: 'Stock transfer',
};

/** Documents can carry up to 3,000 lines (see MAX_DOCUMENT_LINES). */
const SAVE_TIMEOUT_MS = 60_000;
const POST_TIMEOUT_MS = 120_000;
const LINE_UPDATE_CHUNK = 1000;

type Decimal = Prisma.Decimal;

const adjustmentTypeOf = (difference: Decimal | null) =>
  difference === null || difference.isZero() ? null : difference.isPositive() ? 'IN' : 'OUT';

const toDateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

const ZERO = new Prisma.Decimal(0);

/** Header totals from the saved line rows (quantity, or counted quantity for adjustments). */
function documentTotals(rows: Array<{ quantity: Decimal | null; physicalQuantity: Decimal | null; lineTotal: Decimal | null }>) {
  return {
    totalLines: rows.length,
    totalQuantity: rows.reduce((sum, r) => sum.add(r.quantity ?? r.physicalQuantity ?? ZERO), ZERO),
    totalValue: rows.reduce((sum, r) => sum.add(r.lineTotal ?? ZERO), ZERO),
  };
}

type Attachment = { fileAssetId: string; fileName: string; mimeType: string; fileSize: number; uploadedBy: string; uploadedAt: string };
const attachmentsOf = (value: Prisma.JsonValue | null): Attachment[] => (Array.isArray(value) ? (value as unknown as Attachment[]) : []);

@Injectable()
export class InventoryDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: InventoryDocumentsRepository,
    private readonly lineResolver: InventoryLineResolverService,
    private readonly stockPosting: StockPostingService,
    private readonly auditService: AuditService,
    private readonly subcontractor: SubcontractorLocationService,
  ) {}

  private inTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn(tx as unknown as Prisma.TransactionClient),
      options,
    );
  }

  async list(type: InventoryDocumentType, companyId: string, query: InventoryDocumentListQueryDto) {
    const { items, total, page, limit } = await this.repository.list(
      parseBigIntId(companyId, 'companyId'),
      type,
      query,
    );
    const stores = await this.repository.storesByDocument(items.map((doc) => doc.documentId));
    const rows = items.map(({ _count, ...doc }) => ({
      ...this.mapHeader(doc),
      lineCount: _count.lines,
      stores: stores.get(doc.documentId.toString()) ?? [],
    }));
    const named = await this.withActorNames(serialize(rows));
    return toPaginatedResult(named, total, page, limit);
  }

  async findOne(type: InventoryDocumentType, companyId: string, id: string) {
    const doc = await this.repository.findDetail(
      this.prisma,
      parseBigIntId(companyId, 'companyId'),
      type,
      parseBigIntId(id),
    );
    if (!doc) throw new NotFoundException(DOCUMENT_LABEL[type]);
    return this.toResponse(doc);
  }

  async create(type: InventoryDocumentType, companyId: string, dto: InventoryDocumentInput, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const doc = await this.inTransaction(
      async (tx) => {
        const mapped = await this.subcontractor.mapLines(tx, company, dto.lines, actorId);
        const lines = await this.lineResolver.resolve(tx, companyId, actorId, type, mapped);
        const header = await this.headerData(tx, company, type, dto);
        const lineRows = await this.lineRows(tx, company, type, lines);
        const created = await tx.inventoryDocument.create({
          data: {
            ...header,
            ...documentTotals(lineRows),
            companyId: company,
            documentType: type,
            documentNumber: await this.repository.nextDocumentNumber(tx, company, type),
            createdBy: BigInt(actorId),
          },
          select: { documentId: true, documentNumber: true },
        });
        await tx.inventoryDocumentLine.createMany({
          data: lineRows.map((row) => ({ ...row, documentId: created.documentId, companyId: company })),
        });
        return created;
      },
      { timeout: SAVE_TIMEOUT_MS },
    );
    await this.audit(companyId, actorId, UserAuditAction.create, type, doc.documentId, {
      documentNumber: doc.documentNumber,
      lines: dto.lines.length,
    });
    return this.findOne(type, companyId, doc.documentId.toString());
  }

  /** Full replace of a DRAFT (header + lines). */
  async update(
    type: InventoryDocumentType,
    companyId: string,
    id: string,
    dto: InventoryDocumentInput,
    actorId: string,
  ) {
    const company = parseBigIntId(companyId, 'companyId');
    const documentId = parseBigIntId(id);
    await this.inTransaction(
      async (tx) => {
        const mapped = await this.subcontractor.mapLines(tx, company, dto.lines, actorId);
        const lines = await this.lineResolver.resolve(tx, companyId, actorId, type, mapped);
        const header = await this.headerData(tx, company, type, dto);
        const lineRows = await this.lineRows(tx, company, type, lines);
        const claimed = await tx.inventoryDocument.updateMany({
          where: { documentId, companyId: company, documentType: type, deletedAt: null, status: InventoryDocumentStatus.DRAFT },
          data: {
            ...header,
            ...documentTotals(lineRows),
            updatedBy: BigInt(actorId),
            updatedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        if (claimed.count === 0) await this.throwNotDraft(tx, company, type, documentId, 'edited');

        await tx.inventoryDocumentLine.deleteMany({ where: { documentId } });
        await tx.inventoryDocumentLine.createMany({
          data: lineRows.map((row) => ({ ...row, documentId, companyId: company })),
        });
      },
      { timeout: SAVE_TIMEOUT_MS },
    );
    await this.audit(companyId, actorId, UserAuditAction.update, type, documentId, { lines: dto.lines.length });
    return this.findOne(type, companyId, id);
  }

  async remove(type: InventoryDocumentType, companyId: string, id: string, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const documentId = parseBigIntId(id);
    await this.inTransaction(async (tx) => {
      const claimed = await tx.inventoryDocument.updateMany({
        where: { documentId, companyId: company, documentType: type, deletedAt: null, status: InventoryDocumentStatus.DRAFT },
        data: { deletedAt: new Date(), deletedBy: BigInt(actorId) },
      });
      if (claimed.count === 0) await this.throwNotDraft(tx, company, type, documentId, 'deleted');
    });
    await this.audit(companyId, actorId, UserAuditAction.delete, type, documentId);
    return { message: `${DOCUMENT_LABEL[type]} draft deleted` };
  }

  /**
   * DRAFT → POSTED in one transaction: claim the document row (blocks double posting), re-validate
   * lines against current masters, lock balances, write ledger + balances. Any failure rolls back all.
   */
  async post(type: InventoryDocumentType, companyId: string, id: string, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const documentId = parseBigIntId(id);
    const actor = BigInt(actorId);

    const posted = await this.inTransaction(
      async (tx) => {
        const now = new Date();
        const claimed = await tx.inventoryDocument.updateMany({
          where: { documentId, companyId: company, documentType: type, deletedAt: null, status: InventoryDocumentStatus.DRAFT },
          data: {
            status: InventoryDocumentStatus.POSTED,
            postedAt: now,
            postedBy: actor,
            updatedAt: now,
            updatedBy: actor,
            rowVersion: { increment: 1 },
          },
        });
        if (claimed.count === 0) await this.throwNotDraft(tx, company, type, documentId, 'posted');

        const doc = (await this.repository.findDetail(tx, company, type, documentId))!;
        const resolved = await this.lineResolver.resolve(
          tx,
          companyId,
          actorId,
          type,
          doc.lines.map((line) => ({
            itemId: line.itemId.toString(),
            warehouseId: line.warehouseId.toString(),
            siteId: line.branchId?.toString() ?? null,
            storageBinId: line.storageBinId?.toString() ?? null,
            toStorageBinId: line.toStorageBinId?.toString() ?? null,
            quantity: line.quantity?.toString(),
            unitPrice: line.unitPrice?.toString(),
            physicalQuantity: line.physicalQuantity?.toString(),
            batchNo: line.batchNo ?? undefined,
            serialNo: line.serialNo ?? undefined,
            zeroPriceConfirmed: line.zeroPriceConfirmed,
          })),
        );

        if (type === InventoryDocumentType.OPENING_STOCK) {
          await this.assertOpeningRules(tx, company, doc.documentId, doc.documentDate, resolved);
          await this.refreshOpeningTotals(tx, doc.documentId, resolved);
        } else {
          await this.assertNotBeforeOpening(tx, company, doc.documentDate, resolved);
        }
        const movements = await this.buildMovements(tx, company, doc, resolved);
        await this.stockPosting.applyMovements(tx, company, actor, movements);
        return {
          documentNumber: doc.documentNumber,
          movements: movements.filter((m) => !m.quantity.isZero()).length,
        };
      },
      { timeout: POST_TIMEOUT_MS },
    );
    await this.audit(companyId, actorId, UserAuditAction.update, type, documentId, {
      action: 'post',
      ...posted,
    });
    return this.findOne(type, companyId, id);
  }

  /**
   * Opening Stock created already POSTED inside the caller's transaction (used by the opening
   * stock import approve, so new items, the document and the ledger commit or roll back together).
   * Same line validation and posting as create + post. The caller writes the audit row.
   */
  async createPostedOpeningStock(
    tx: Prisma.TransactionClient,
    companyId: string,
    dto: InventoryDocumentInput,
    lineRefs: Array<{ revision?: string | null; partCode?: string | null; materialGrade?: string | null; size?: string | null }>,
    actorId: string,
  ) {
    const type = InventoryDocumentType.OPENING_STOCK;
    const company = parseBigIntId(companyId, 'companyId');
    const actor = BigInt(actorId);
    const now = new Date();
    const mapped = await this.subcontractor.mapLines(tx, company, dto.lines, actorId);
    const lines = await this.lineResolver.resolve(tx, companyId, actorId, type, mapped);
    const header = await this.headerData(tx, company, type, dto);
    const lineRows = await this.lineRows(tx, company, type, lines);
    await this.assertOpeningRules(tx, company, null, header.documentDate, lines);
    const created = await tx.inventoryDocument.create({
      data: {
        ...header,
        ...documentTotals(lineRows),
        companyId: company,
        documentType: type,
        documentNumber: await this.repository.nextDocumentNumber(tx, company, type),
        status: InventoryDocumentStatus.POSTED,
        postedAt: now,
        postedBy: actor,
        createdBy: actor,
      },
      select: { documentId: true, documentNumber: true },
    });
    await tx.inventoryDocumentLine.createMany({
      data: lineRows.map((row, i) => ({
        ...row,
        documentId: created.documentId,
        companyId: company,
        revision: lineRefs[i]?.revision ?? null,
        partCode: lineRefs[i]?.partCode ?? null,
        materialGrade: lineRefs[i]?.materialGrade ?? null,
        size: lineRefs[i]?.size ?? null,
      })),
    });
    const doc = (await this.repository.findDetail(tx, company, type, created.documentId))!;
    const movements = await this.buildMovements(tx, company, doc, lines);
    await this.stockPosting.applyMovements(tx, company, actor, movements);
    return created;
  }

  /**
   * Opening Stock posting rules, run under the balance row locks so two documents for the same
   * item + location + bin cannot both pass: unit price confirmed when 0, no earlier posted opening
   * stock for the key, serial not used twice for the item, no movement dated before this opening.
   */
  private async assertOpeningRules(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    documentId: bigint | null,
    documentDate: Date,
    lines: ResolvedInventoryLine[],
  ) {
    const fail = (code: string, status: HttpStatus, message: string, field: string): never => {
      throw new BusinessException(message, status, [{ field, message }], code);
    };
    lines.forEach((line, i) => {
      if ((!line.unitPrice || line.unitPrice.isZero()) && !line.zeroPriceConfirmed) {
        fail(
          INVENTORY_DOCUMENT_ERROR_CODES.ZERO_PRICE,
          HttpStatus.BAD_REQUEST,
          `${line.itemCode}: unit price is 0. Enter the price or confirm zero value`,
          `lines[${i}].unitPrice`,
        );
      }
    });
    if (lines.length === 0) return;
    await this.stockPosting.lockBalances(tx, companyId, lines);

    const keys = lines.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId, storageBinId: l.storageBinId }));
    const otherPosted: Prisma.InventoryDocumentWhereInput = {
      documentType: InventoryDocumentType.OPENING_STOCK,
      status: InventoryDocumentStatus.POSTED,
      deletedAt: null,
      ...(documentId ? { NOT: { documentId } } : {}),
    };
    const existing = await tx.inventoryDocumentLine.findFirst({
      where: { companyId, document: otherPosted, OR: keys },
      select: {
        itemId: true,
        warehouseId: true,
        storageBinId: true,
        item: { select: { itemCode: true } },
        warehouse: { select: { vendor: { select: { name: true } } } },
        document: { select: { documentNumber: true } },
      },
    });
    if (existing) {
      const i = lines.findIndex(
        (l) => l.itemId === existing.itemId && l.warehouseId === existing.warehouseId && l.storageBinId === existing.storageBinId,
      );
      fail(
        INVENTORY_DOCUMENT_ERROR_CODES.OPENING_EXISTS,
        HttpStatus.CONFLICT,
        `Opening stock for ${existing.item.itemCode} ${existing.warehouse.vendor ? `at vendor ${existing.warehouse.vendor.name}` : 'at this location'} is already posted (${existing.document.documentNumber}). Use Stock Adjustment`,
        `lines[${Math.max(i, 0)}].itemId`,
      );
    }

    const serials = lines.flatMap((l) => (l.serialNo ? [{ itemId: l.itemId, serialNo: l.serialNo }] : []));
    if (serials.length > 0) {
      const used = await tx.inventoryDocumentLine.findFirst({
        where: { companyId, document: otherPosted, OR: serials },
        select: { serialNo: true, item: { select: { itemCode: true } } },
      });
      if (used) {
        const i = lines.findIndex((l) => l.serialNo === used.serialNo);
        fail(
          INVENTORY_DOCUMENT_ERROR_CODES.SERIAL_DUPLICATE,
          HttpStatus.CONFLICT,
          `Serial ${used.serialNo} of ${used.item.itemCode} is already in opening stock`,
          `lines[${Math.max(i, 0)}].serialNo`,
        );
      }
    }

    const earlier = await tx.stockLedgerEntry.findFirst({
      where: { companyId, movementType: { not: StockMovementType.OPENING_STOCK }, transactionDate: { lt: documentDate }, OR: keys },
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true, documentNumber: true, itemId: true, warehouseId: true, storageBinId: true },
    });
    if (earlier) {
      const i = lines.findIndex(
        (l) => l.itemId === earlier.itemId && l.warehouseId === earlier.warehouseId && l.storageBinId === earlier.storageBinId,
      );
      fail(
        INVENTORY_DOCUMENT_ERROR_CODES.BEFORE_OPENING,
        HttpStatus.BAD_REQUEST,
        `${lines[Math.max(i, 0)].itemCode} already has a movement on ${toDateOnly(earlier.transactionDate)} (${earlier.documentNumber}), before this opening stock date`,
        'documentDate',
      );
    }
  }

  /** Material Issue / Stock Adjustment cannot be dated before the key's opening stock date. */
  private async assertNotBeforeOpening(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    documentDate: Date,
    lines: ResolvedInventoryLine[],
  ) {
    if (lines.length === 0) return;
    const opening = await tx.stockLedgerEntry.findFirst({
      where: {
        companyId,
        movementType: StockMovementType.OPENING_STOCK,
        transactionDate: { gt: documentDate },
        OR: lines.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId, storageBinId: l.storageBinId })),
      },
      orderBy: { transactionDate: 'desc' },
      select: { transactionDate: true, documentNumber: true, item: { select: { itemCode: true } } },
    });
    if (opening) {
      const message = `${opening.item.itemCode}: date is before its opening stock date ${toDateOnly(opening.transactionDate)} (${opening.documentNumber})`;
      throw new BusinessException(message, HttpStatus.BAD_REQUEST, [{ field: 'documentDate', message }], INVENTORY_DOCUMENT_ERROR_CODES.BEFORE_OPENING);
    }
  }

  /** Line totals + header totals recomputed from the re-resolved lines at posting time. */
  private async refreshOpeningTotals(tx: Prisma.TransactionClient, documentId: bigint, lines: ResolvedInventoryLine[]) {
    const rows = await tx.inventoryDocumentLine.findMany({ where: { documentId }, orderBy: { lineNo: 'asc' }, select: { lineId: true } });
    const totals = lines.map((l) => (l.quantity ?? ZERO).mul(l.unitPrice ?? ZERO).toDecimalPlaces(6));
    for (let i = 0; i < rows.length; i += LINE_UPDATE_CHUNK) {
      const part = rows.slice(i, i + LINE_UPDATE_CHUNK);
      await tx.$executeRaw`
        UPDATE inventory_document_lines AS l SET line_total = u.line_total
        FROM unnest(${part.map((r) => r.lineId)}::bigint[], ${part.map((_, j) => totals[i + j].toString())}::numeric[]) AS u(line_id, line_total)
        WHERE l.line_id = u.line_id`;
    }
    await tx.inventoryDocument.update({
      where: { documentId },
      data: {
        totalLines: lines.length,
        totalQuantity: lines.reduce((sum, l) => sum.add(l.quantity ?? ZERO), ZERO),
        totalValue: totals.reduce((sum, t) => sum.add(t), ZERO),
      },
    });
  }

  private async buildMovements(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    doc: InventoryDocumentDetail,
    resolved: ResolvedInventoryLine[],
  ): Promise<StockMovementInput[]> {
    const base = (line: InventoryDocumentDetail['lines'][number], r: ResolvedInventoryLine, index: number) => ({
      sourceType: INVENTORY_DOCUMENT_SOURCE,
      sourceLineId: line.lineId,
      documentId: doc.documentId,
      documentNumber: doc.documentNumber,
      transactionDate: doc.documentDate,
      itemId: r.itemId,
      branchId: r.branchId,
      warehouseId: r.warehouseId,
      storageBinId: r.storageBinId,
      uom: r.uom,
      label: r.itemCode,
      errorField: `lines[${index}].quantity`,
    });

    switch (doc.documentType) {
      case InventoryDocumentType.OPENING_STOCK:
        return doc.lines.map((line, i) => ({
          ...base(line, resolved[i], i),
          movementType: StockMovementType.OPENING_STOCK,
          quantity: resolved[i].quantity!,
          unitCost: resolved[i].unitPrice,
        }));

      case InventoryDocumentType.MATERIAL_ISSUE:
        return doc.lines.map((line, i) => ({
          ...base(line, resolved[i], i),
          movementType: StockMovementType.MATERIAL_ISSUE,
          quantity: resolved[i].quantity!.negated(),
        }));

      case InventoryDocumentType.STOCK_ADJUSTMENT: {
        // System quantity is the committed stock at posting time, read under the row lock.
        const locked = await this.stockPosting.lockBalances(tx, companyId, resolved);
        const movements: StockMovementInput[] = [];
        const snapshots: Array<{ lineId: bigint; systemQuantity: Decimal; difference: Decimal }> = [];
        for (const [i, line] of doc.lines.entries()) {
          const r = resolved[i];
          const systemQuantity = locked.get(stockKey(r))!.quantity;
          const difference = r.physicalQuantity!.sub(systemQuantity);
          snapshots.push({ lineId: line.lineId, systemQuantity, difference });
          movements.push({
            ...base(line, r, i),
            errorField: `lines[${i}].physicalQuantity`,
            movementType: difference.isNegative()
              ? StockMovementType.ADJUSTMENT_OUT
              : StockMovementType.ADJUSTMENT_IN,
            quantity: difference,
          });
        }
        for (let i = 0; i < snapshots.length; i += LINE_UPDATE_CHUNK) {
          const part = snapshots.slice(i, i + LINE_UPDATE_CHUNK);
          await tx.$executeRaw`
            UPDATE inventory_document_lines AS l
            SET system_quantity = u.system_quantity, difference = u.difference
            FROM unnest(
              ${part.map((s) => s.lineId)}::bigint[],
              ${part.map((s) => s.systemQuantity.toString())}::numeric[],
              ${part.map((s) => s.difference.toString())}::numeric[]
            ) AS u(line_id, system_quantity, difference)
            WHERE l.line_id = u.line_id`;
        }
        return movements;
      }

      case InventoryDocumentType.STOCK_TRANSFER:
        return doc.lines.flatMap((line, i) => {
          const r = resolved[i];
          const qty = r.quantity!;
          return [
            {
              ...base(line, r, i),
              movementType: StockMovementType.TRANSFER_OUT,
              quantity: qty.negated(),
            },
            {
              ...base(line, r, i),
              storageBinId: r.toStorageBinId,
              movementType: StockMovementType.TRANSFER_IN,
              quantity: qty,
              errorField: `lines[${i}].toStorageBinId`,
            },
          ];
        });
    }
  }

  private async headerData(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    type: InventoryDocumentType,
    dto: InventoryDocumentInput,
  ) {
    const documentDate = new Date(`${dto.documentDate}T00:00:00.000Z`);
    if (Number.isNaN(documentDate.getTime()) || toDateOnly(documentDate) !== dto.documentDate) {
      throw new BusinessException(
        'Invalid date',
        HttpStatus.BAD_REQUEST,
        [{ field: 'documentDate', message: 'Invalid date' }],
        INVENTORY_DOCUMENT_ERROR_CODES.INVALID_DATE,
      );
    }
    const common = { documentDate, remarks: dto.remarks ?? null };

    if (type === InventoryDocumentType.MATERIAL_ISSUE) {
      const departmentId = dto.departmentId ? BigInt(dto.departmentId) : null;
      if (
        departmentId &&
        !(await tx.department.findFirst({ where: { departmentId, companyId, deletedAt: null }, select: { departmentId: true } }))
      ) {
        throw new BusinessException(
          'Department not found',
          HttpStatus.BAD_REQUEST,
          [{ field: 'departmentId', message: 'Department not found in this company' }],
          INVENTORY_DOCUMENT_ERROR_CODES.DEPARTMENT_NOT_FOUND,
        );
      }
      return {
        ...common,
        requestedBy: dto.requestedBy ?? null,
        issuedBy: dto.issuedBy ?? null,
        departmentId,
        purpose: dto.purpose ?? null,
      };
    }
    if (type === InventoryDocumentType.STOCK_ADJUSTMENT) {
      return { ...common, reason: dto.reason ?? null };
    }
    if (type === InventoryDocumentType.STOCK_TRANSFER) {
      return common;
    }
    const defaultWarehouseId = dto.defaultWarehouseId ? BigInt(dto.defaultWarehouseId) : null;
    const defaultStoreCategoryId = dto.defaultStoreCategoryId ? BigInt(dto.defaultStoreCategoryId) : null;
    if (defaultWarehouseId && defaultStoreCategoryId) {
      throw new BusinessException(
        'Choose either a store location or the Sub Contractor store as the header store',
        HttpStatus.BAD_REQUEST,
        [{ field: 'defaultStoreCategoryId', message: 'Only one header store' }],
        INVENTORY_DOCUMENT_ERROR_CODES.DEFAULT_LOCATION_INVALID,
      );
    }
    if (defaultStoreCategoryId) {
      await this.subcontractor.requireStore(tx, companyId, defaultStoreCategoryId.toString(), 'defaultStoreCategoryId');
      return { ...common, defaultWarehouseId: null, defaultStoreCategoryId };
    }
    if (
      defaultWarehouseId &&
      !(await tx.warehouse.findFirst({
        where: { warehouseId: defaultWarehouseId, companyId, deletedAt: null, isActive: true },
        select: { warehouseId: true },
      }))
    ) {
      throw new BusinessException(
        'Store not found or inactive',
        HttpStatus.BAD_REQUEST,
        [{ field: 'defaultWarehouseId', message: 'Store not found or inactive' }],
        INVENTORY_DOCUMENT_ERROR_CODES.DEFAULT_LOCATION_INVALID,
      );
    }
    return { ...common, defaultWarehouseId, defaultStoreCategoryId: null };
  }

  private async lineRows(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    type: InventoryDocumentType,
    lines: ResolvedInventoryLine[],
  ) {
    const system =
      type === InventoryDocumentType.STOCK_ADJUSTMENT
        ? await this.stockPosting.readBalances(tx, companyId, lines)
        : null;
    const opening = type === InventoryDocumentType.OPENING_STOCK;
    return lines.map((line) => {
      const systemQuantity = system?.get(stockKey(line)) ?? null;
      return {
        lineNo: line.lineNo,
        itemId: line.itemId,
        branchId: line.branchId,
        warehouseId: line.warehouseId,
        storageBinId: line.storageBinId,
        toStorageBinId: type === InventoryDocumentType.STOCK_TRANSFER ? line.toStorageBinId : null,
        uom: line.uom,
        quantity: type === InventoryDocumentType.STOCK_ADJUSTMENT ? null : line.quantity,
        unitPrice: opening ? line.unitPrice : null,
        systemQuantity,
        physicalQuantity: type === InventoryDocumentType.STOCK_ADJUSTMENT ? line.physicalQuantity : null,
        difference: systemQuantity && line.physicalQuantity ? line.physicalQuantity.sub(systemQuantity) : null,
        remarks: line.remarks,
        batchNo: opening ? line.batchNo : null,
        serialNo: opening ? line.serialNo : null,
        lineTotal: opening ? (line.quantity ?? ZERO).mul(line.unitPrice ?? ZERO).toDecimalPlaces(6) : null,
        zeroPriceConfirmed: opening ? line.zeroPriceConfirmed : false,
      };
    });
  }

  private async throwNotDraft(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    type: InventoryDocumentType,
    documentId: bigint,
    action: 'edited' | 'deleted' | 'posted',
  ): Promise<never> {
    const existing = await tx.inventoryDocument.findFirst({
      where: { documentId, companyId, documentType: type, deletedAt: null },
      select: { status: true },
    });
    if (!existing) throw new NotFoundException(DOCUMENT_LABEL[type]);
    throw new BusinessException(
      action === 'posted'
        ? `${DOCUMENT_LABEL[type]} is already posted`
        : `Posted ${DOCUMENT_LABEL[type].toLowerCase()} cannot be ${action}`,
      HttpStatus.CONFLICT,
      undefined,
      action === 'posted'
        ? INVENTORY_DOCUMENT_ERROR_CODES.ALREADY_POSTED
        : INVENTORY_DOCUMENT_ERROR_CODES.POSTED_LOCKED,
    );
  }

  private mapHeader(doc: Omit<InventoryDocumentDetail, 'lines'>) {
    return {
      documentId: doc.documentId,
      documentType: doc.documentType,
      documentNumber: doc.documentNumber,
      documentDate: toDateOnly(doc.documentDate),
      status: doc.status,
      remarks: doc.remarks,
      ...(doc.documentType === InventoryDocumentType.MATERIAL_ISSUE
        ? {
            requestedBy: doc.requestedBy,
            issuedBy: doc.issuedBy,
            departmentId: doc.departmentId,
            department: doc.department,
            purpose: doc.purpose,
          }
        : {}),
      ...(doc.documentType === InventoryDocumentType.STOCK_ADJUSTMENT ? { reason: doc.reason } : {}),
      ...(doc.documentType === InventoryDocumentType.OPENING_STOCK
        ? {
            defaultWarehouseId: doc.defaultWarehouseId,
            defaultWarehouse: doc.defaultWarehouse
              ? { warehouseId: doc.defaultWarehouse.warehouseId, code: doc.defaultWarehouse.warehouseCode, name: doc.defaultWarehouse.name }
              : null,
            defaultStoreCategoryId: doc.defaultStoreCategoryId,
            defaultStore: doc.defaultStore
              ? { storeCategoryId: doc.defaultStore.storeCategoryId, name: doc.defaultStore.name, storeType: doc.defaultStore.storeType }
              : null,
            attachments: attachmentsOf(doc.attachmentsJson),
          }
        : {}),
      totalLines: doc.totalLines,
      totalQuantity: doc.totalQuantity.toFixed(6),
      totalValue: doc.totalValue.toFixed(2),
      postedAt: doc.postedAt,
      postedBy: doc.postedBy,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      updatedBy: doc.updatedBy,
      updatedAt: doc.updatedAt,
    };
  }

  private async toResponse(doc: InventoryDocumentDetail) {
    const isDraft = doc.status === InventoryDocumentStatus.DRAFT;
    // Drafts show live stock; posted documents show what was frozen at posting.
    const live = isDraft
      ? await this.stockPosting.readBalances(this.prisma as unknown as Prisma.TransactionClient, doc.companyId, doc.lines)
      : null;

    const lines = doc.lines.map((line) => {
      const current = live?.get(stockKey(line)) ?? null;
      const systemQuantity = current ?? line.systemQuantity;
      const difference =
        doc.documentType === InventoryDocumentType.STOCK_ADJUSTMENT && systemQuantity && line.physicalQuantity
          ? line.physicalQuantity.sub(systemQuantity)
          : null;
      return {
        lineId: line.lineId,
        lineNo: line.lineNo,
        itemId: line.itemId,
        partNumber: line.item.itemCode,
        partName: line.item.description,
        uom: line.uom,
        siteId: line.branchId,
        siteCode: line.branch?.branchCode ?? null,
        siteName: line.branch?.name ?? null,
        branchId: line.branchId,
        inventoryLocationId: line.warehouseId,
        warehouseId: line.warehouseId,
        locationCode: line.warehouse.warehouseCode,
        locationName: line.warehouse.name,
        storageBinId: line.storageBinId,
        binCode: line.storageBin?.binCode ?? null,
        binName: line.storageBin?.binName ?? null,
        remarks: line.remarks,
        itemType: line.item.itemGroupRef?.categoryCode ?? null,
        itemCategoryName: line.item.itemGroupRef?.name ?? null,
        locationVendor: line.warehouse.vendor
          ? { vendorId: line.warehouse.vendor.vendorId, code: line.warehouse.vendor.vendorCode, name: line.warehouse.vendor.name }
          : null,
        storeType: line.warehouse.storeCategory?.storeType ?? 'NORMAL',
        /** Sub Contractor lines: show the store + vendor, never the internal vendor location */
        storeCategoryId: line.warehouse.storeCategory?.storeType === 'SUBCONTRACTOR' ? line.warehouse.storeCategory.storeCategoryId : null,
        storeName: line.warehouse.storeCategory?.name ?? null,
        vendorId: line.warehouse.vendor?.vendorId ?? null,
        ...(doc.documentType === InventoryDocumentType.OPENING_STOCK
          ? {
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal?.toFixed(2) ?? null,
              zeroPriceConfirmed: line.zeroPriceConfirmed,
              batchNo: line.batchNo,
              serialNo: line.serialNo,
              revision: line.revision,
              manageBy: line.item.manageBy,
            }
          : {}),
        ...(doc.documentType === InventoryDocumentType.MATERIAL_ISSUE
          ? { quantity: line.quantity, availableQuantity: current }
          : {}),
        ...(doc.documentType === InventoryDocumentType.STOCK_ADJUSTMENT
          ? {
              systemQuantity,
              physicalQuantity: line.physicalQuantity,
              difference,
              adjustmentType: adjustmentTypeOf(difference),
            }
          : {}),
        ...(doc.documentType === InventoryDocumentType.STOCK_TRANSFER
          ? {
              quantity: line.quantity,
              availableQuantity: current,
              toStorageBinId: line.toStorageBinId,
              toBinCode: line.toStorageBin?.binCode ?? null,
              toBinName: line.toStorageBin?.binName ?? null,
            }
          : {}),
      };
    });

    const importBatch =
      doc.documentType === InventoryDocumentType.OPENING_STOCK ? await this.importBatchOf(doc.documentId) : null;
    const partIndex =
      doc.documentType === InventoryDocumentType.OPENING_STOCK ? this.buildOpeningPartIndex(lines) : undefined;
    const [named] = await this.withActorNames(
      serialize([{ ...this.mapHeader(doc), importBatch, ...(partIndex ? { partIndex } : {}), lines }]),
    );
    return named;
  }

  /**
   * Opening Stock index rows for FE: one entry per part with total qty, bin chips, serials.
   * Expand still uses flat `lines` (filter by itemId / lineIds).
   */
  private buildOpeningPartIndex(
    lines: Array<{
      lineId: bigint | string;
      itemId: bigint | string;
      partNumber: string;
      partName: string;
      inventoryLocationId: bigint | string;
      locationCode: string;
      locationName: string;
      storageBinId: bigint | string | null;
      binCode: string | null;
      quantity?: Decimal | null;
      serialNo?: string | null;
      uom: string | null;
    }>,
  ) {
    type Acc = {
      itemId: string;
      partNumber: string;
      partName: string;
      uom: string | null;
      inventoryLocationId: string;
      locationCode: string;
      locationName: string;
      totalQuantity: Decimal;
      lineIds: string[];
      bins: Array<{ storageBinId: string | null; binCode: string | null }>;
      serialNumbers: string[];
    };
    const map = new Map<string, Acc>();
    for (const line of lines) {
      const itemId = line.itemId.toString();
      const loc = line.inventoryLocationId.toString();
      const key = `${itemId}:${loc}`;
      let row = map.get(key);
      if (!row) {
        row = {
          itemId,
          partNumber: line.partNumber,
          partName: line.partName,
          uom: line.uom,
          inventoryLocationId: loc,
          locationCode: line.locationCode,
          locationName: line.locationName,
          totalQuantity: ZERO,
          lineIds: [],
          bins: [],
          serialNumbers: [],
        };
        map.set(key, row);
      }
      row.lineIds.push(line.lineId.toString());
      row.totalQuantity = row.totalQuantity.add(line.quantity ?? ZERO);
      const binCode = line.binCode;
      if (binCode && !row.bins.some((b) => b.binCode === binCode)) {
        row.bins.push({
          storageBinId: line.storageBinId?.toString() ?? null,
          binCode,
        });
      }
      const sn = line.serialNo?.trim();
      if (sn && !row.serialNumbers.includes(sn)) row.serialNumbers.push(sn);
    }
    return [...map.values()].map((row) => ({
      itemId: row.itemId,
      partNumber: row.partNumber,
      partName: row.partName,
      uom: row.uom,
      inventoryLocationId: row.inventoryLocationId,
      locationCode: row.locationCode,
      locationName: row.locationName,
      totalQuantity: row.totalQuantity.toFixed(6),
      lineCount: row.lineIds.length,
      lineIds: row.lineIds,
      bins: row.bins,
      serialNumbers: row.serialNumbers,
      serialCount: row.serialNumbers.length,
    }));
  }

  /** The Excel import that created this posted Opening Stock (file name, approver, new items). */
  private async importBatchOf(documentId: bigint) {
    const batch = await this.prisma.openingStockImportBatch.findFirst({
      where: { documentId },
      select: { batchId: true, fileName: true, approvedBy: true, approvedAt: true },
    });
    if (!batch) return null;
    const created = await this.prisma.openingStockImportRow.findMany({
      where: { batchId: batch.batchId, createdItemId: { not: null } },
      select: { createdItemId: true },
      distinct: ['createdItemId'],
    });
    const names = await this.auditService.loadActorNames(batch.approvedBy ? [batch.approvedBy.toString()] : []);
    return {
      batchId: batch.batchId,
      fileName: batch.fileName,
      approvedBy: batch.approvedBy,
      approvedByName: batch.approvedBy ? names.get(batch.approvedBy.toString()) ?? null : null,
      approvedAt: batch.approvedAt,
      createdItemCount: created.length,
    };
  }

  private async withActorNames<T extends Record<string, unknown>>(rows: T[]) {
    const ids = rows.flatMap((r) => [r.createdBy, r.updatedBy, r.postedBy]).filter(Boolean) as string[];
    const names = await this.auditService.loadActorNames(ids);
    const name = (id: unknown) => (id ? names.get(String(id)) ?? null : null);
    return rows.map((r) => ({
      ...r,
      createdByName: name(r.createdBy),
      updatedByName: name(r.updatedBy),
      postedByName: name(r.postedBy),
    }));
  }

  private audit(
    companyId: string,
    actorId: string,
    action: UserAuditAction,
    type: InventoryDocumentType,
    documentId: bigint,
    newValue?: Record<string, unknown>,
  ) {
    return this.auditService.log({
      companyId,
      performedBy: actorId,
      action,
      entityName: `InventoryDocument:${type}`,
      entityId: documentId.toString(),
      newValue,
    });
  }
}
