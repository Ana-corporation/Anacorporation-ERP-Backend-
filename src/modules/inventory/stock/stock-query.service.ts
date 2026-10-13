import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { CurrentStockQueryDto, StockLedgerQueryDto } from './dto/stock-query.dto';
import { itemInventoryUom } from './inventory-line-resolver.service';

type LedgerRow = {
  entry_id: bigint;
  transaction_date: Date;
  movement_type: string;
  document_id: bigint | null;
  document_number: string;
  item_id: bigint;
  item_code: string;
  item_name: string;
  branch_id: bigint | null;
  branch_code: string | null;
  branch_name: string | null;
  warehouse_id: bigint;
  warehouse_code: string;
  warehouse_name: string;
  storage_bin_id: bigint | null;
  bin_code: string | null;
  bin_name: string | null;
  qty_in: Prisma.Decimal;
  qty_out: Prisma.Decimal;
  running_balance: Prisma.Decimal;
  uom: string | null;
  unit_cost: Prisma.Decimal | null;
  total_value: Prisma.Decimal | null;
  created_by: bigint | null;
  created_at: Date;
  total_count: bigint;
};

const CURRENT_STOCK_SORT: Record<string, (dir: Prisma.SortOrder) => Prisma.StockBalanceOrderByWithRelationInput> = {
  partNumber: (dir) => ({ item: { itemCode: dir } }),
  partName: (dir) => ({ item: { description: dir } }),
  location: (dir) => ({ warehouse: { warehouseCode: dir } }),
  quantity: (dir) => ({ quantity: dir }),
};

/** Unknown sortBy (incl. the list default createdAt) = part number A→Z. */
function currentStockOrder(sortBy: string, sortOrder: Prisma.SortOrder | undefined) {
  const sort = CURRENT_STOCK_SORT[sortBy];
  return sort ? sort(sortOrder ?? 'asc') : CURRENT_STOCK_SORT.partNumber('asc');
}

/** Read-only Current Stock and Stock Ledger. Both respect the user's warehouse data scope. */
@Injectable()
export class StockQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly dataAccessPoliciesService: DataAccessPoliciesService,
  ) {}

  async currentStock(companyId: string, userId: string, query: CurrentStockQueryDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const { skip, limit, page } = getPaginationParams(query);
    const scopeWarehouses = await this.scopedWarehouseIds(companyId, userId);
    const warehouseId = query.inventoryLocationId || query.warehouseId;
    const branchId = query.siteId || query.branchId;
    const search = query.search?.trim();

    const where: Prisma.StockBalanceWhereInput = {
      companyId: company,
      ...(query.itemId ? { itemId: BigInt(query.itemId) } : {}),
      ...(branchId ? { warehouse: { branchId: BigInt(branchId) } } : {}),
      ...(query.storageBinId ? { storageBinId: BigInt(query.storageBinId) } : {}),
      ...(query.includeZero ? {} : { quantity: { not: 0 } }),
      ...(search
        ? {
            item: {
              OR: [
                { itemCode: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
      AND: [
        ...(warehouseId ? [{ warehouseId: BigInt(warehouseId) }] : []),
        ...(scopeWarehouses ? [{ warehouseId: { in: scopeWarehouses } }] : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockBalance.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          currentStockOrder(query.sortBy, query.sortOrder),
          { item: { itemCode: 'asc' } },
          { warehouse: { warehouseCode: 'asc' } },
          { binKey: 'asc' },
        ],
        include: {
          item: { select: { itemCode: true, description: true, inventoryJson: true } },
          warehouse: {
            select: {
              warehouseCode: true,
              name: true,
              branch: { select: { branchId: true, branchCode: true, name: true } },
            },
          },
          storageBin: { select: { binCode: true, binName: true } },
        },
      }),
      this.prisma.stockBalance.count({ where }),
    ]);

    const items = rows.map((row) => ({
      stockBalanceId: row.stockBalanceId,
      itemId: row.itemId,
      partNumber: row.item.itemCode,
      partName: row.item.description,
      siteId: row.warehouse.branch?.branchId ?? null,
      siteCode: row.warehouse.branch?.branchCode ?? null,
      siteName: row.warehouse.branch?.name ?? null,
      branchId: row.warehouse.branch?.branchId ?? null,
      inventoryLocationId: row.warehouseId,
      warehouseId: row.warehouseId,
      locationCode: row.warehouse.warehouseCode,
      locationName: row.warehouse.name,
      storageBinId: row.storageBinId,
      binCode: row.storageBin?.binCode ?? null,
      binName: row.storageBin?.binName ?? null,
      uom: itemInventoryUom(row.item.inventoryJson),
      quantity: row.quantity,
      updatedAt: row.updatedAt ?? row.createdAt,
    }));
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  /**
   * Chronological ledger. runningBalance is per item over the selected item/site/location/bin,
   * computed over ALL earlier movements, so it already includes the balance before fromDate.
   * Date, transaction type and document filters only choose which rows are shown.
   */
  async ledger(companyId: string, userId: string, query: StockLedgerQueryDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const { skip, limit, page } = getPaginationParams(query);
    const scopeWarehouses = await this.scopedWarehouseIds(companyId, userId);
    const warehouseId = query.inventoryLocationId || query.warehouseId;
    const branchId = query.siteId || query.branchId;
    const types = query.movementType ?? query.transactionType;

    const scope: Prisma.Sql[] = [Prisma.sql`l.company_id = ${company}`];
    if (query.itemId) scope.push(Prisma.sql`l.item_id = ${BigInt(query.itemId)}`);
    if (branchId) scope.push(Prisma.sql`l.branch_id = ${BigInt(branchId)}`);
    if (warehouseId) scope.push(Prisma.sql`l.warehouse_id = ${BigInt(warehouseId)}`);
    if (query.storageBinId) scope.push(Prisma.sql`l.storage_bin_id = ${BigInt(query.storageBinId)}`);
    if (scopeWarehouses) {
      scope.push(
        scopeWarehouses.length
          ? Prisma.sql`l.warehouse_id IN (${Prisma.join(scopeWarehouses)})`
          : Prisma.sql`FALSE`,
      );
    }

    const shown: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.fromDate) shown.push(Prisma.sql`s.transaction_date >= ${query.fromDate}::date`);
    if (query.toDate) shown.push(Prisma.sql`s.transaction_date <= ${query.toDate}::date`);
    if (types?.length) shown.push(Prisma.sql`s.movement_type::text IN (${Prisma.join(types)})`);
    const docNumber = query.documentNumber || query.search?.trim();
    if (docNumber) shown.push(Prisma.sql`s.document_number ILIKE ${`%${docNumber}%`}`);

    const scopeWhere = Prisma.join(scope, ' AND ');
    const rows = await this.prisma.$queryRaw<LedgerRow[]>`
      WITH scoped AS (
        SELECT l.*,
          SUM(l.qty_in - l.qty_out) OVER (
            PARTITION BY l.item_id ORDER BY l.transaction_date, l.entry_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS running_balance
        FROM stock_ledger_entries l
        WHERE ${scopeWhere}
      ), shown AS (
        SELECT s.*, COUNT(*) OVER () AS total_count
        FROM scoped s
        WHERE ${Prisma.join(shown, ' AND ')}
      )
      SELECT sh.entry_id, sh.transaction_date, sh.movement_type::text AS movement_type,
        sh.document_id, sh.document_number, sh.item_id, i.item_code, i.description AS item_name,
        sh.branch_id, b.branch_code, b.name AS branch_name,
        sh.warehouse_id, w.warehouse_code, w.name AS warehouse_name,
        sh.storage_bin_id, sb.bin_code, sb.bin_name,
        sh.qty_in, sh.qty_out, sh.running_balance, sh.uom, sh.unit_cost, sh.total_value,
        sh.created_by, sh.created_at, sh.total_count
      FROM shown sh
      JOIN items i ON i.item_id = sh.item_id
      JOIN warehouses w ON w.warehouse_id = sh.warehouse_id
      LEFT JOIN branches b ON b.branch_id = sh.branch_id
      LEFT JOIN storage_bins sb ON sb.storage_bin_id = sh.storage_bin_id
      ORDER BY sh.transaction_date, sh.entry_id
      LIMIT ${limit} OFFSET ${skip}`;

    let openingBalance: Prisma.Decimal | null = null;
    if (query.itemId && query.fromDate) {
      const [row] = await this.prisma.$queryRaw<Array<{ balance: Prisma.Decimal | null }>>`
        SELECT SUM(l.qty_in - l.qty_out) AS balance FROM stock_ledger_entries l
        WHERE ${scopeWhere} AND l.transaction_date < ${query.fromDate}::date`;
      openingBalance = row?.balance ?? new Prisma.Decimal(0);
    }

    const names = await this.auditService.loadActorNames(
      rows.map((r) => r.created_by?.toString() ?? '').filter(Boolean),
    );
    const total = rows.length ? Number(rows[0].total_count) : await this.countShown(scopeWhere, shown);
    const items = rows.map((r) => ({
      entryId: r.entry_id,
      transactionDate: r.transaction_date.toISOString().slice(0, 10),
      transactionType: r.movement_type,
      referenceDocumentId: r.document_id,
      referenceDocumentNumber: r.document_number,
      itemId: r.item_id,
      partNumber: r.item_code,
      partName: r.item_name,
      siteId: r.branch_id,
      siteCode: r.branch_code,
      siteName: r.branch_name,
      inventoryLocationId: r.warehouse_id,
      locationCode: r.warehouse_code,
      locationName: r.warehouse_name,
      storageBinId: r.storage_bin_id,
      binCode: r.bin_code,
      binName: r.bin_name,
      quantityIn: r.qty_in,
      quantityOut: r.qty_out,
      runningBalance: r.running_balance,
      uom: r.uom,
      unitCost: r.unit_cost,
      totalValue: r.total_value,
      createdBy: r.created_by,
      createdByName: r.created_by ? names.get(r.created_by.toString()) ?? null : null,
      createdAt: r.created_at,
    }));
    return serialize({ ...toPaginatedResult(items, total, page, limit), openingBalance });
  }

  /** Page past the end: rows is empty, so count separately. */
  private async countShown(scopeWhere: Prisma.Sql, shown: Prisma.Sql[]) {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM (SELECT l.* FROM stock_ledger_entries l WHERE ${scopeWhere}) s
      WHERE ${Prisma.join(shown, ' AND ')}`;
    return Number(row?.n ?? 0);
  }

  /** null = unrestricted; otherwise the warehouses the user's data access policies allow. */
  private async scopedWarehouseIds(companyId: string, userId: string): Promise<bigint[] | null> {
    const scope = await this.dataAccessPoliciesService.resolveUserDataScope(userId, companyId);
    return scope.isRestricted ? scope.warehouseIds.map((id) => BigInt(id)) : null;
  }
}
