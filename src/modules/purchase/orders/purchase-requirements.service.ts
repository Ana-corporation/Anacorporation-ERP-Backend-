import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  PurchaseRequirementSourceType,
  PurchaseRequirementStatus,
  UserAuditAction,
} from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { requirementView } from './purchase.mapper';
import {
  asDate,
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
  BomRunDto,
  ConsolidateDto,
  CreateRequirementDto,
  RequirementListQueryDto,
  UpdateRequirementDto,
} from './dto/purchase.dto';

const requirementInclude = {
  item: {
    select: {
      itemId: true,
      itemCode: true,
      oldCode: true,
      description: true,
      currencyCode: true,
      preferredVendorId: true,
    },
  },
} satisfies Prisma.PurchaseRequirementInclude;

type BomLine = {
  bom_line_id: bigint;
  line_type: string;
  parent_line_id: bigint | null;
  component_item_id: bigint;
  quantity: Prisma.Decimal;
  uom_id: bigint;
  item_code: string;
  old_code: string | null;
  description: string;
};

const OPEN_FOR_PO = new Set<PurchaseRequirementStatus>([
  PurchaseRequirementStatus.DRAFT,
  PurchaseRequirementStatus.PENDING_REVIEW,
  PurchaseRequirementStatus.APPROVED,
  PurchaseRequirementStatus.PARTIALLY_CONVERTED,
]);

@Injectable()
export class PurchaseRequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, query: RequirementListQueryDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const { page, limit, skip } = getPaginationParams(query);
    const search = query.search?.trim();
    const where: Prisma.PurchaseRequirementWhereInput = {
      companyId: company,
      ...(query.status ? { status: query.status as PurchaseRequirementStatus } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType as PurchaseRequirementSourceType } : {}),
      ...(query.warehouseId ? { warehouseId: parseBigIntId(query.warehouseId, 'warehouseId') } : {}),
      ...(search
        ? {
            OR: [
              { prNo: { contains: search, mode: 'insensitive' } },
              { bomNumber: { contains: search, mode: 'insensitive' } },
              { item: { itemCode: { contains: search, mode: 'insensitive' } } },
              { item: { oldCode: { contains: search, mode: 'insensitive' } } },
              { item: { description: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseRequirement.findMany({
        where,
        include: requirementInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.purchaseRequirement.count({ where }),
    ]);
    const currencyId = await this.companyCurrency(company);
    return serialize(toPaginatedResult(rows.map((row) => requirementView(row, currencyId)), total, page, limit));
  }

  async create(companyId: string, dto: CreateRequirementDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const actor = parseBigIntId(actorId, 'userId');
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertItemWarehouse(tx, company, dto.itemId, dto.warehouseId, dto.uomId, dto.suggestedVendorId);
      const row = await tx.purchaseRequirement.create({
        data: {
          companyId: company,
          prNo: await nextNumber(tx, company, 'PR'),
          sourceType: PurchaseRequirementSourceType.REPLENISHMENT,
          itemId: parseBigIntId(dto.itemId, 'itemId'),
          warehouseId: parseBigIntId(dto.warehouseId, 'warehouseId'),
          uomId: parseBigIntId(dto.uomId, 'uomId'),
          requiredQty: D(dto.requiredQty),
          requiredDate: asDate(dto.requiredDate),
          suggestedVendorId: dto.suggestedVendorId ? parseBigIntId(dto.suggestedVendorId, 'suggestedVendorId') : null,
          reason: dto.reason,
          status: PurchaseRequirementStatus.DRAFT,
          createdBy: actor,
        },
        include: requirementInclude,
      });
      await audit(tx, company, actor, UserAuditAction.create, 'purchase_requirement', row.purchaseRequirementId, {
        prNo: row.prNo,
      });
      return row;
    });
    return requirementView(created, await this.companyCurrency(company));
  }

  async update(companyId: string, id: string, dto: UpdateRequirementDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const requirementId = parseBigIntId(id, 'purchaseRequirementId');
    const actor = parseBigIntId(actorId, 'userId');
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.purchaseRequirement.findFirst({ where: { purchaseRequirementId: requirementId, companyId: company } });
      if (!current) throw new NotFoundException('Purchase requirement');
      if (current.status !== PurchaseRequirementStatus.DRAFT) fail('Only a draft requirement can be edited', 'PR_NOT_OPEN');
      if (current.rowVersion !== dto.rowVersion) fail('Changed by someone else. Reload?', 'ROW_VERSION_CONFLICT', HttpStatus.CONFLICT);
      const saved = await tx.purchaseRequirement.update({
        where: { purchaseRequirementId: requirementId },
        data: {
          ...(dto.requiredQty ? { requiredQty: D(dto.requiredQty) } : {}),
          ...(dto.requiredDate ? { requiredDate: asDate(dto.requiredDate) } : {}),
          ...(dto.suggestedVendorId !== undefined
            ? { suggestedVendorId: dto.suggestedVendorId ? parseBigIntId(dto.suggestedVendorId, 'suggestedVendorId') : null }
            : {}),
          ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
          updatedBy: actor,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
        include: requirementInclude,
      });
      return saved;
    });
    return requirementView(updated, await this.companyCurrency(company));
  }

  async cancel(companyId: string, id: string, rowVersion: number, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const requirementId = parseBigIntId(id, 'purchaseRequirementId');
    const actor = parseBigIntId(actorId, 'userId');
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.purchaseRequirement.findFirst({ where: { purchaseRequirementId: requirementId, companyId: company } });
      if (!current) throw new NotFoundException('Purchase requirement');
      if (current.rowVersion !== rowVersion) fail('Changed by someone else. Reload?', 'ROW_VERSION_CONFLICT', HttpStatus.CONFLICT);
      if (!OPEN_FOR_PO.has(current.status) || D(current.convertedQty).greaterThan(0)) {
        fail('This requirement is already on a purchase order', 'PR_NOT_OPEN');
      }
      return tx.purchaseRequirement.update({
        where: { purchaseRequirementId: requirementId },
        data: {
          status: PurchaseRequirementStatus.CANCELLED,
          updatedBy: actor,
          updatedAt: new Date(),
          rowVersion: { increment: 1 },
        },
        include: requirementInclude,
      });
    });
    return requirementView(updated, await this.companyCurrency(company));
  }

  async previewFromBom(companyId: string, dto: BomRunDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const preview = await this.expandBom(company, dto);
    return { lines: preview.lines };
  }

  async createFromBom(companyId: string, dto: BomRunDto, actorId: string, idempotencyKey?: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const actor = parseBigIntId(actorId, 'userId');
    return withIdempotency(this.prisma, company, actor, 'POST /purchase-requirements/from-bom', idempotencyKey, dto, async (tx) => {
      const preview = await this.expandBom(company, dto, tx);
      const shortages = preview.lines.filter((line) => line.hasShortage);
      const run = await tx.purchaseRequirementRun.create({
        data: {
          companyId: company,
          machineId: parseBigIntId(dto.machineId, 'machineId'),
          bomId: parseBigIntId(dto.bomId, 'bomId'),
          bomVersion: preview.bomVersion,
          bomNumber: preview.bomNumber,
          machineQty: D(dto.machineQty),
          warehouseId: parseBigIntId(dto.warehouseId, 'warehouseId'),
          requiredDate: asDate(dto.requiredDate),
          linesSnapshot: preview.lines as unknown as Prisma.InputJsonValue,
          idempotencyKey: idempotencyKey?.trim(),
          createdBy: actor,
        },
      });
      const currencyId = await this.companyCurrency(company, tx);
      const created = [];
      for (const line of shortages) {
        const row = await tx.purchaseRequirement.create({
          data: {
            companyId: company,
            prNo: await nextNumber(tx, company, 'PR'),
            sourceType: PurchaseRequirementSourceType.SHORTAGE,
            runId: run.purchaseRequirementRunId,
            machineId: parseBigIntId(dto.machineId, 'machineId'),
            bomId: parseBigIntId(dto.bomId, 'bomId'),
            bomVersion: line.bomVersion,
            bomNumber: line.bomNumber,
            itemId: parseBigIntId(line.itemId, 'itemId'),
            warehouseId: parseBigIntId(dto.warehouseId, 'warehouseId'),
            uomId: parseBigIntId(line.uomId, 'uomId'),
            requiredQty: D(line.shortageQty),
            requiredDate: asDate(dto.requiredDate),
            suggestedVendorId: line.suggestedVendorId ? parseBigIntId(line.suggestedVendorId, 'suggestedVendorId') : null,
            status: PurchaseRequirementStatus.APPROVED,
            createdBy: actor,
          },
          include: requirementInclude,
        });
        created.push(requirementView(row, currencyId));
      }
      return { runId: run.purchaseRequirementRunId.toString(), items: created };
    });
  }

  async consolidatePreview(companyId: string, dto: ConsolidateDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const ids = dto.purchaseRequirementIds.map((id) => parseBigIntId(id, 'purchaseRequirementId'));
    const rows = await this.prisma.purchaseRequirement.findMany({
      where: { companyId: company, purchaseRequirementId: { in: ids } },
      include: requirementInclude,
    });
    if (rows.length !== ids.length) fail('One or more requirements were not found', 'PR_NOT_FOUND', HttpStatus.NOT_FOUND);
    const currencyId = await this.companyCurrency(company);
    const views = rows.map((row) => requirementView(row, currencyId));
    const vendorKey = new Set(views.map((row) => row.suggestedVendorId ?? ''));
    const uomKey = new Set(views.map((row) => row.uomId ?? ''));
    const warehouseKey = new Set(views.map((row) => row.warehouseId));
    const compatible = vendorKey.size <= 1 && uomKey.size <= 1 && warehouseKey.size <= 1 && views.every((row) => D(row.openQty).greaterThan(0) && OPEN_FOR_PO.has(row.status as PurchaseRequirementStatus));
    const grouped = new Map<string, { itemId: string; uomId: string | null; warehouseId: string; ordered: Prisma.Decimal; requiredDate: string | null; sources: { purchaseRequirementId: string; prNo: string; qty: string }[] }>();
    for (const row of views) {
      const key = `${row.itemId}:${row.uomId}:${row.warehouseId}`;
      const current = grouped.get(key) ?? {
        itemId: row.itemId,
        uomId: row.uomId,
        warehouseId: row.warehouseId,
        ordered: D(0),
        requiredDate: row.requiredDate,
        sources: [],
      };
      current.ordered = current.ordered.plus(row.openQty);
      if (row.requiredDate && (!current.requiredDate || row.requiredDate < current.requiredDate)) current.requiredDate = row.requiredDate;
      current.sources.push({ purchaseRequirementId: row.purchaseRequirementId, prNo: row.prNo, qty: row.openQty });
      grouped.set(key, current);
    }
    return {
      compatible,
      message: compatible ? 'Requirements can be combined.' : 'Selected requirements do not share vendor, UOM, and warehouse.',
      lines: [...grouped.values()].map((line) => ({
        itemId: line.itemId,
        uomId: line.uomId,
        warehouseId: line.warehouseId,
        orderedQty: money(line.ordered),
        requiredDate: line.requiredDate,
        sources: line.sources,
      })),
    };
  }

  private async expandBom(companyId: bigint, dto: BomRunDto, db: PurchaseTx | PrismaService = this.prisma) {
    const machineId = parseBigIntId(dto.machineId, 'machineId');
    const bomId = parseBigIntId(dto.bomId, 'bomId');
    const warehouseId = parseBigIntId(dto.warehouseId, 'warehouseId');
    const machines = await db.$queryRaw<{ machine_id: bigint; machine_code: string }[]>`
      SELECT machine_id, machine_code FROM machines
      WHERE company_id = ${companyId} AND machine_id = ${machineId} AND deleted_at IS NULL
    `;
    if (!machines[0]) fail('Machine was not found', 'MACHINE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const boms = await db.$queryRaw<{ bom_id: bigint; bom_number: string; version: number; status: string }[]>`
      SELECT bom_id, bom_number, version, status::text AS status FROM boms
      WHERE company_id = ${companyId} AND bom_id = ${bomId} AND deleted_at IS NULL
    `;
    if (!boms[0]) fail('BOM was not found', 'BOM_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (boms[0].status !== 'RELEASED') fail('Only a released BOM can create requirements', 'BOM_NOT_RELEASED');
    const warehouse = await db.warehouse.findFirst({ where: { warehouseId, companyId, deletedAt: null }, select: { warehouseId: true } });
    if (!warehouse) fail('Warehouse was not found', 'WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const lines = await db.$queryRaw<BomLine[]>`
      SELECT bl.bom_line_id, bl.line_type::text AS line_type, bl.parent_line_id, bl.component_item_id,
             bl.quantity, bl.uom_id, i.item_code, i.old_code, i.description
      FROM bom_lines bl
      JOIN items i ON i.item_id = bl.component_item_id
      WHERE bl.company_id = ${companyId} AND bl.bom_id = ${bomId}
    `;
    const parents = new Set(lines.map((line) => line.parent_line_id?.toString()).filter(Boolean));
    const purchasable = lines.filter((line) => line.line_type === 'SUB' || (line.line_type === 'MAIN' && !parents.has(line.bom_line_id.toString())));
    const machineQty = D(dto.machineQty);
    const grouped = new Map<string, { itemId: bigint; uomId: bigint; partNo: string; oldPartNo: string | null; name: string; required: Prisma.Decimal }>();
    for (const line of purchasable) {
      const key = line.component_item_id.toString();
      const required = D(line.quantity).mul(machineQty);
      const current = grouped.get(key);
      if (current) current.required = current.required.plus(required);
      else {
        grouped.set(key, {
          itemId: line.component_item_id,
          uomId: line.uom_id,
          partNo: line.item_code,
          oldPartNo: line.old_code,
          name: line.description,
          required,
        });
      }
    }
    const result = [];
    for (const line of grouped.values()) {
      const stock = await db.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM(quantity), 0) AS qty FROM stock_balances
        WHERE company_id = ${companyId} AND item_id = ${line.itemId} AND warehouse_id = ${warehouseId}
      `;
      const available = D(stock[0]?.qty ?? 0);
      const shortage = line.required.minus(available);
      const item = await db.item.findFirst({
        where: { itemId: line.itemId, companyId },
        select: { preferredVendorId: true },
      });
      result.push({
        itemId: line.itemId.toString(),
        partNo: line.partNo,
        oldPartNo: line.oldPartNo,
        name: line.name,
        uomId: line.uomId.toString(),
        requiredQty: money(line.required),
        availableQty: money(available),
        shortageQty: money(shortage.greaterThan(0) ? shortage : 0),
        hasShortage: shortage.greaterThan(0),
        suggestedVendorId: item?.preferredVendorId?.toString() ?? null,
        bomVersion: boms[0].version,
        bomNumber: boms[0].bom_number,
      });
    }
    return { bomVersion: boms[0].version, bomNumber: boms[0].bom_number, lines: result };
  }

  private async companyCurrency(companyId: bigint, db: PurchaseTx | PrismaService = this.prisma) {
    const company = await db.company.findFirst({
      where: { companyId },
      select: { defaultCurrencyId: true },
    });
    return company?.defaultCurrencyId?.toString() ?? null;
  }

  private async assertItemWarehouse(
    tx: PurchaseTx,
    companyId: bigint,
    itemId: string,
    warehouseId: string,
    uomId: string,
    vendorId?: string | null,
  ) {
    const item = await tx.item.findFirst({ where: { itemId: parseBigIntId(itemId, 'itemId'), companyId, deletedAt: null }, select: { itemId: true } });
    if (!item) fail('Item was not found', 'ITEM_NOT_FOUND', HttpStatus.NOT_FOUND);
    const warehouse = await tx.warehouse.findFirst({ where: { warehouseId: parseBigIntId(warehouseId, 'warehouseId'), companyId, deletedAt: null }, select: { warehouseId: true } });
    if (!warehouse) fail('Warehouse was not found', 'WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const uom = await tx.$queryRaw<{ uom_id: bigint }[]>`
      SELECT uom_id FROM uoms WHERE company_id = ${companyId} AND uom_id = ${parseBigIntId(uomId, 'uomId')} AND deleted_at IS NULL
    `;
    if (!uom[0]) fail('UOM was not found', 'UOM_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (vendorId) {
      const vendor = await tx.vendor.findFirst({ where: { vendorId: parseBigIntId(vendorId, 'suggestedVendorId'), companyId, deletedAt: null }, select: { vendorId: true } });
      if (!vendor) fail('Vendor was not found', 'VENDOR_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
  }
}
