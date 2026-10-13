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

export const INVENTORY_DOCUMENT_ERROR_CODES = {
  POSTED_LOCKED: 'INVENTORY_DOCUMENT_POSTED',
  ALREADY_POSTED: 'INVENTORY_DOCUMENT_ALREADY_POSTED',
  INVALID_DATE: 'INVENTORY_INVALID_DATE',
  DEPARTMENT_NOT_FOUND: 'INVENTORY_DEPARTMENT_NOT_FOUND',
} as const;

export const INVENTORY_DOCUMENT_SOURCE = 'INVENTORY_DOCUMENT';

const DOCUMENT_LABEL: Record<InventoryDocumentType, string> = {
  OPENING_STOCK: 'Opening stock',
  MATERIAL_ISSUE: 'Material issue',
  STOCK_ADJUSTMENT: 'Stock adjustment',
};

const POST_TIMEOUT_MS = 30_000;

type Decimal = Prisma.Decimal;

const adjustmentTypeOf = (difference: Decimal | null) =>
  difference === null || difference.isZero() ? null : difference.isPositive() ? 'IN' : 'OUT';

const toDateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

@Injectable()
export class InventoryDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: InventoryDocumentsRepository,
    private readonly lineResolver: InventoryLineResolverService,
    private readonly stockPosting: StockPostingService,
    private readonly auditService: AuditService,
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
    const rows = items.map(({ _count, ...doc }) => ({
      ...this.mapHeader(doc),
      lineCount: _count.lines,
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
    const doc = await this.inTransaction(async (tx) => {
      const lines = await this.lineResolver.resolve(tx, companyId, actorId, type, dto.lines);
      const header = await this.headerData(tx, company, type, dto);
      const lineRows = await this.lineRows(tx, company, type, lines);
      return tx.inventoryDocument.create({
        data: {
          ...header,
          companyId: company,
          documentType: type,
          documentNumber: await this.repository.nextDocumentNumber(tx, company, type),
          createdBy: BigInt(actorId),
          lines: { create: lineRows.map((row) => ({ ...row, companyId: company })) },
        },
        select: { documentId: true, documentNumber: true },
      });
    });
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
    await this.inTransaction(async (tx) => {
      const lines = await this.lineResolver.resolve(tx, companyId, actorId, type, dto.lines);
      const header = await this.headerData(tx, company, type, dto);
      const claimed = await tx.inventoryDocument.updateMany({
        where: { documentId, companyId: company, documentType: type, deletedAt: null, status: InventoryDocumentStatus.DRAFT },
        data: { ...header, updatedBy: BigInt(actorId), updatedAt: new Date(), rowVersion: { increment: 1 } },
      });
      if (claimed.count === 0) await this.throwNotDraft(tx, company, type, documentId, 'edited');

      const lineRows = await this.lineRows(tx, company, type, lines);
      await tx.inventoryDocumentLine.deleteMany({ where: { documentId } });
      await tx.inventoryDocumentLine.createMany({
        data: lineRows.map((row) => ({ ...row, documentId, companyId: company })),
      });
    });
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
            quantity: line.quantity?.toString(),
            unitPrice: line.unitPrice?.toString(),
            physicalQuantity: line.physicalQuantity?.toString(),
          })),
        );

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
        for (const [i, line] of doc.lines.entries()) {
          const r = resolved[i];
          const systemQuantity = locked.get(stockKey(r))!.quantity;
          const difference = r.physicalQuantity!.sub(systemQuantity);
          await tx.inventoryDocumentLine.update({
            where: { lineId: line.lineId },
            data: { systemQuantity, difference },
          });
          movements.push({
            ...base(line, r, i),
            errorField: `lines[${i}].physicalQuantity`,
            movementType: difference.isNegative()
              ? StockMovementType.ADJUSTMENT_OUT
              : StockMovementType.ADJUSTMENT_IN,
            quantity: difference,
          });
        }
        return movements;
      }
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
    return common;
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
    return lines.map((line) => {
      const systemQuantity = system?.get(stockKey(line)) ?? null;
      return {
        lineNo: line.lineNo,
        itemId: line.itemId,
        branchId: line.branchId,
        warehouseId: line.warehouseId,
        storageBinId: line.storageBinId,
        uom: line.uom,
        quantity: type === InventoryDocumentType.STOCK_ADJUSTMENT ? null : line.quantity,
        unitPrice: type === InventoryDocumentType.OPENING_STOCK ? line.unitPrice : null,
        systemQuantity,
        physicalQuantity: type === InventoryDocumentType.STOCK_ADJUSTMENT ? line.physicalQuantity : null,
        difference: systemQuantity && line.physicalQuantity ? line.physicalQuantity.sub(systemQuantity) : null,
        remarks: line.remarks,
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
        ...(doc.documentType === InventoryDocumentType.OPENING_STOCK
          ? { quantity: line.quantity, unitPrice: line.unitPrice }
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
      };
    });

    const [named] = await this.withActorNames(serialize([{ ...this.mapHeader(doc), lines }]));
    return named;
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
