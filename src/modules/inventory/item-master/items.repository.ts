import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import {
  buildListWhere,
  resolveOrderBy,
  ListFilterOptions,
} from '@/common/utils/prisma-filter.util';
import {
  CreateItemDto,
  ItemListQueryDto,
  UpdateItemDto,
  UpsertItemWarehouseStockDto,
} from './dto/item.dto';
import { formatItemCode, parseItemAutoSequence } from './item-code.util';

const ITEMS_LIST_FILTER: ListFilterOptions = {
  contains: {
    code: 'itemCode',
    description: 'description',
    brandName: 'brandName',
  },
  exact: {
    status: 'status',
    itemType: 'itemType',
    itemGroup: 'itemGroup',
    division: 'division',
    majorGroup: 'majorGroup',
  },
  booleans: {
    isActive: 'isActive',
    isInventoryItem: 'isInventoryItem',
    isSalesItem: 'isSalesItem',
    isPurchaseItem: 'isPurchaseItem',
  },
  dateRange: { field: 'createdAt' },
  searchFields: ['itemCode', 'description', 'oldCode', 'barcode', 'brandName'],
  sortFields: ['itemCode', 'description', 'status', 'createdAt'],
  defaultSortField: 'createdAt',
  tieBreaker: 'itemId',
};

const STORE_CATEGORY_INCLUDE = {
  storeCategory: { select: { storeCategoryId: true, name: true, numberSeriesCode: true } },
  itemGroupRef: { select: { itemGroupId: true, name: true, parentId: true } },
  inventoryUom: {
    select: { uomId: true, code: true, name: true, category: true, decimalPlaces: true, isSystem: true },
  },
  previousStageItem: {
    where: { deletedAt: null },
    select: {
      itemId: true,
      itemCode: true,
      materialStage: true,
      itemGroupRef: { select: { categoryCode: true } },
      previousStageItem: {
        where: { deletedAt: null },
        select: { itemId: true, itemCode: true, materialStage: true, itemGroupRef: { select: { categoryCode: true } } },
      },
    },
  },
  nextStageItem: {
    where: { deletedAt: null },
    select: {
      itemId: true,
      itemCode: true,
      materialStage: true,
      itemGroupRef: { select: { categoryCode: true } },
      nextStageItem: {
        where: { deletedAt: null },
        select: { itemId: true, itemCode: true, materialStage: true, itemGroupRef: { select: { categoryCode: true } } },
      },
    },
  },
} satisfies Prisma.ItemInclude;

const WAREHOUSE_STOCK_INCLUDE = {
  ...STORE_CATEGORY_INCLUDE,
  warehouseStock: {
    include: {
      warehouse: {
        select: { warehouseId: true, warehouseCode: true, name: true },
      },
    },
    orderBy: { warehouseId: 'asc' },
  },
} satisfies Prisma.ItemInclude;

type JsonBag = Record<string, unknown> | undefined;

function toJson(value: JsonBag): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

/** Shallow-merge PATCH bag into existing JSON so FE can send only changed keys.
 *  Hidden Form Configuration fields omitted from the UI must NOT clear stored bag values. */
function mergeJsonBag(
  existing: unknown,
  incoming: JsonBag,
): Prisma.InputJsonValue | undefined {
  if (incoming === undefined) return undefined;
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, ...incoming } as Prisma.InputJsonValue;
}

/** DTO carries dates as `YYYY-MM-DD` strings; anchor to UTC so the day never shifts. */
function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  return new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
}

@Injectable()
export class ItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  get db(): Prisma.TransactionClient {
    return this.prisma as unknown as Prisma.TransactionClient;
  }

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Prisma.TransactionClient));
  }

  private async itemGroupWithDescendants(companyId: bigint, itemGroupId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ item_group_id: bigint }>>`
      WITH RECURSIVE tree AS (
        SELECT item_group_id, 0 AS depth FROM item_groups
        WHERE item_group_id = ${itemGroupId} AND company_id = ${companyId}
        UNION ALL
        SELECT g.item_group_id, t.depth + 1 FROM item_groups g
        JOIN tree t ON g.parent_id = t.item_group_id
        WHERE g.deleted_at IS NULL AND t.depth < 50
      )
      SELECT item_group_id FROM tree`;
    return rows.map((r) => r.item_group_id);
  }

  findItemGroup(itemGroupId: string, companyId: string) {
    return this.prisma.itemGroup.findFirst({
      where: {
        itemGroupId: parseBigIntId(itemGroupId, 'itemGroupId'),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        isActive: true,
      },
      select: { itemGroupId: true, storeCategoryId: true },
    });
  }

  findUom(uomId: string, companyId: string) {
    return this.prisma.uom.findFirst({
      where: {
        uomId: parseBigIntId(uomId, 'inventoryUomId'),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        isActive: true,
      },
      select: { uomId: true, code: true },
    });
  }

  /** Live item with the same Old Code (drawing / previous PN), case-insensitive. */
  findByOldCode(companyId: string, oldCode: string, excludeItemId?: string) {
    return this.prisma.item.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        oldCode: { equals: oldCode.trim(), mode: 'insensitive' },
        ...(excludeItemId ? { NOT: { itemId: parseBigIntId(excludeItemId) } } : {}),
      },
      select: { itemId: true, itemCode: true, oldCode: true },
    });
  }

  /** Other live items in the same store with the same description (case-insensitive). */
  findSameNameInStore(companyId: string, storeCategoryId: string, description: string, excludeItemId?: string) {
    return this.prisma.item.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        storeCategoryId: parseBigIntId(storeCategoryId, 'storeCategoryId'),
        deletedAt: null,
        description: { equals: description.trim(), mode: 'insensitive' },
        ...(excludeItemId ? { NOT: { itemId: parseBigIntId(excludeItemId) } } : {}),
      },
      select: { itemId: true, itemCode: true, description: true },
      take: 5,
    });
  }

  /** Stock on hand, any stock movement, or a line on a live inventory document. */
  async isUsedInInventory(itemId: string): Promise<boolean> {
    const id = parseBigIntId(itemId);
    const [balance, ledger, line] = await Promise.all([
      this.prisma.stockBalance.findFirst({ where: { itemId: id, quantity: { not: 0 } }, select: { stockBalanceId: true } }),
      this.prisma.stockLedgerEntry.findFirst({ where: { itemId: id }, select: { entryId: true } }),
      this.prisma.inventoryDocumentLine.findFirst({
        where: { itemId: id, document: { deletedAt: null } },
        select: { lineId: true },
      }),
    ]);
    return Boolean(balance || ledger || line);
  }

  setImage(itemId: string, fileAssetId: string | null, updatedBy?: string) {
    return this.prisma.item.update({
      where: { itemId: parseBigIntId(itemId) },
      data: {
        imageFileAssetId: fileAssetId,
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
      select: { itemId: true, imageFileAssetId: true },
    });
  }

  findStoreCategory(storeCategoryId: string, companyId: string) {
    return this.prisma.storeCategory.findFirst({
      where: {
        storeCategoryId: parseBigIntId(storeCategoryId, 'storeCategoryId'),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        isActive: true,
      },
      select: { storeCategoryId: true },
    });
  }

  async findManyByCompany(companyId: string, query: ItemListQueryDto, recordIdFilter?: bigint[] | null) {
    const { skip, limit, page } = getPaginationParams(query);
    if (recordIdFilter && recordIdFilter.length === 0) {
      return { items: [], total: 0, page, limit };
    }
    const cid = parseBigIntId(companyId);
    const groupIds = query.itemGroupId ? await this.itemGroupWithDescendants(cid, BigInt(query.itemGroupId)) : null;
    const where = buildListWhere(
      {
        companyId: cid,
        deletedAt: null,
        ...(recordIdFilter ? { itemId: { in: recordIdFilter } } : {}),
        ...(query.storeCategoryId ? { storeCategoryId: BigInt(query.storeCategoryId) } : {}),
        ...(query.inventoryUomId ? { inventoryUomId: BigInt(query.inventoryUomId) } : {}),
        ...(groupIds ? { itemGroupId: { in: groupIds } } : {}),
        ...(query.excludeMachines ? { machine: { is: null } } : {}),
      },
      query,
      ITEMS_LIST_FILTER,
    ) as Prisma.ItemWhereInput;

    return this.prisma
      .$transaction([
        this.prisma.item.findMany({
          where,
          skip,
          take: limit,
          orderBy: resolveOrderBy(query, ITEMS_LIST_FILTER),
          include: STORE_CATEGORY_INCLUDE,
        }),
        this.prisma.item.count({ where }),
      ])
      .then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.item.findFirst({
      where: {
        itemId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: WAREHOUSE_STOCK_INCLUDE,
    });
  }

  findByCode(companyId: string, itemCode: string) {
    return this.prisma.item.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        itemCode,
        deletedAt: null,
      },
    });
  }

  /** Includes soft-deleted — needed for unique(companyId, itemCode) safety. */
  findAnyByCode(companyId: string, itemCode: string, db: Prisma.TransactionClient = this.db) {
    return db.item.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        itemCode,
      },
      select: { itemId: true, deletedAt: true },
    });
  }

  async getOrCreateItemSettings(companyId: string, actorId?: string) {
    const cid = parseBigIntId(companyId);
    const existing = await this.prisma.companyItemSettings.findUnique({
      where: { companyId: cid },
    });
    if (existing) return existing;

    return this.prisma.companyItemSettings.create({
      data: {
        companyId: cid,
        itemCodeMode: 'AUTO',
        itemCodePrefix: 'ITM',
        createdBy: actorId ? parseBigIntId(actorId) : undefined,
      },
    });
  }

  updateItemSettings(
    companyId: string,
    data: { itemCodeMode: 'AUTO' | 'MANUAL'; itemCodePrefix?: string },
    actorId?: string,
  ) {
    const cid = parseBigIntId(companyId);
    return this.prisma.companyItemSettings.upsert({
      where: { companyId: cid },
      create: {
        companyId: cid,
        itemCodeMode: data.itemCodeMode,
        itemCodePrefix: (data.itemCodePrefix ?? 'ITM').toUpperCase(),
        createdBy: actorId ? parseBigIntId(actorId) : undefined,
      },
      update: {
        itemCodeMode: data.itemCodeMode,
        ...(data.itemCodePrefix !== undefined
          ? { itemCodePrefix: data.itemCodePrefix.toUpperCase() }
          : {}),
        updatedBy: actorId ? parseBigIntId(actorId) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Next AUTO code for prefix (ITM-000001…). Scans all rows including soft-deleted
   * so DB unique(companyId, itemCode) cannot collide.
   */
  async nextAutoItemCode(companyId: string, prefix: string, db: Prisma.TransactionClient = this.db) {
    const p = prefix.trim().toUpperCase() || 'ITM';
    const existing = await db.item.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        itemCode: { startsWith: `${p}-` },
      },
      select: { itemCode: true },
    });

    let maxSeq = 0;
    for (const row of existing) {
      const seq = parseItemAutoSequence(row.itemCode, p);
      if (seq !== null && seq > maxSeq) maxSeq = seq;
    }

    return formatItemCode(p, maxSeq + 1);
  }

  findVendorById(vendorId: string, companyId: string) {
    return this.prisma.vendor.findFirst({
      where: {
        vendorId: parseBigIntId(vendorId, 'preferredVendorId'),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      select: { vendorId: true },
    });
  }

  findWarehouseById(warehouseId: string, companyId: string) {
    return this.prisma.warehouse.findFirst({
      where: {
        warehouseId: parseBigIntId(warehouseId, 'warehouseId'),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      select: { warehouseId: true },
    });
  }

  create(
    companyId: string,
    dto: CreateItemDto,
    itemCode: string,
    createdBy?: string,
    db: Prisma.TransactionClient = this.db,
  ) {
    return db.item.create({
      data: this.createData(companyId, dto, itemCode, createdBy),
      include: WAREHOUSE_STOCK_INCLUDE,
    });
  }

  /** One INSERT for many items (opening stock import); returns id + code per item. */
  createMany(
    db: Prisma.TransactionClient,
    companyId: string,
    rows: Array<{ dto: CreateItemDto; itemCode: string }>,
    createdBy?: string,
  ) {
    return db.item.createManyAndReturn({
      data: rows.map((r) => this.createData(companyId, r.dto, r.itemCode, createdBy)),
      select: { itemId: true, itemCode: true, description: true },
    });
  }

  private createData(
    companyId: string,
    dto: CreateItemDto,
    itemCode: string,
    createdBy?: string,
  ): Prisma.ItemUncheckedCreateInput {
    return {
      companyId: parseBigIntId(companyId),
      itemCode: itemCode.trim().toUpperCase(),
      storeCategoryId: dto.storeCategoryId ? parseBigIntId(dto.storeCategoryId, 'storeCategoryId') : null,
      itemGroupId: dto.itemGroupId ? parseBigIntId(dto.itemGroupId, 'itemGroupId') : null,
      inventoryUomId: dto.inventoryUomId ? parseBigIntId(dto.inventoryUomId, 'inventoryUomId') : null,
      description: dto.description.trim(),
      oldCode: dto.oldCode ?? null,
      itemType: dto.itemType ?? 'item',
      itemGroup: dto.itemGroup ?? null,
      uomGroup: dto.uomGroup ?? null,
      barcode: dto.barcode ?? null,
      priceList: dto.priceList ?? null,
      unitPrice: dto.unitPrice ?? null,
      currencyCode: dto.currencyCode ?? null,

      isInventoryItem: dto.isInventoryItem ?? true,
      isSalesItem: dto.isSalesItem ?? true,
      isPurchaseItem: dto.isPurchaseItem ?? true,

      doNotApplyDiscountGroups: dto.doNotApplyDiscountGroups ?? false,
      manufacturer: dto.manufacturer ?? null,
      additionalIdentifier: dto.additionalIdentifier ?? null,
      shippingType: dto.shippingType ?? null,
      manageBy: dto.manageBy ?? 'none',
      status: dto.status ?? 'active',
      activeFrom: toDate(dto.activeFrom),
      activeTo: toDate(dto.activeTo),

      netWeightKg: dto.netWeightKg ?? null,
      grossWeightKg: dto.grossWeightKg ?? null,
      division: dto.division ?? null,
      coreActivity: dto.coreActivity ?? null,
      majorGroup: dto.majorGroup ?? null,
      brandName: dto.brandName ?? null,
      effectiveDate: toDate(dto.effectiveDate),
      customerStockNo: dto.customerStockNo ?? null,
      stockToBe: dto.stockToBe ?? null,
      stockDioDays: dto.stockDioDays ?? null,
      contractItemsFor: dto.contractItemsFor ?? null,

      preferredVendorId: dto.preferredVendorId
        ? parseBigIntId(dto.preferredVendorId, 'preferredVendorId')
        : null,
      valuationMethod: dto.valuationMethod ?? null,
      itemCost: dto.itemCost ?? null,
      manageStockByWarehouse: dto.manageStockByWarehouse ?? true,

      remarks: dto.remarks ?? null,
      purchaseJson: toJson(dto.purchase),
      salesJson: toJson(dto.sales),
      inventoryJson: toJson(dto.inventory),
      planningJson: toJson(dto.planning),
      productionJson: toJson(dto.production),
      propertiesJson: toJson(dto.properties),
      attachmentsJson: dto.attachments as Prisma.InputJsonValue | undefined,
      metadata: toJson(dto.metadata),

      isActive: dto.isActive ?? true,
      createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
    };
  }

  update(id: string, dto: UpdateItemDto, updatedBy?: string) {
    const set = <T>(value: T | undefined, mapped?: unknown) =>
      value === undefined ? {} : (mapped as object);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.item.findUnique({
        where: { itemId: parseBigIntId(id) },
        select: {
          purchaseJson: true,
          salesJson: true,
          inventoryJson: true,
          planningJson: true,
          productionJson: true,
          propertiesJson: true,
          metadata: true,
        },
      });

      return tx.item.update({
        where: { itemId: parseBigIntId(id) },
        data: {
          ...set(dto.description, { description: dto.description?.trim() }),
          ...set(dto.oldCode, { oldCode: dto.oldCode }),
          ...set(dto.itemType, { itemType: dto.itemType }),
          ...set(dto.itemGroup, { itemGroup: dto.itemGroup }),
          ...set(dto.uomGroup, { uomGroup: dto.uomGroup }),
          ...set(dto.barcode, { barcode: dto.barcode }),
          ...set(dto.priceList, { priceList: dto.priceList }),
          ...set(dto.unitPrice, { unitPrice: dto.unitPrice }),
          ...set(dto.currencyCode, { currencyCode: dto.currencyCode }),

          ...set(dto.isInventoryItem, { isInventoryItem: dto.isInventoryItem }),
          ...set(dto.isSalesItem, { isSalesItem: dto.isSalesItem }),
          ...set(dto.isPurchaseItem, { isPurchaseItem: dto.isPurchaseItem }),

          ...set(dto.doNotApplyDiscountGroups, {
            doNotApplyDiscountGroups: dto.doNotApplyDiscountGroups,
          }),
          ...set(dto.manufacturer, { manufacturer: dto.manufacturer }),
          ...set(dto.additionalIdentifier, {
            additionalIdentifier: dto.additionalIdentifier,
          }),
          ...set(dto.shippingType, { shippingType: dto.shippingType }),
          ...set(dto.manageBy, { manageBy: dto.manageBy }),
          ...set(dto.status, { status: dto.status }),
          ...set(dto.activeFrom, { activeFrom: toDate(dto.activeFrom) }),
          ...set(dto.activeTo, { activeTo: toDate(dto.activeTo) }),

          ...set(dto.netWeightKg, { netWeightKg: dto.netWeightKg }),
          ...set(dto.grossWeightKg, { grossWeightKg: dto.grossWeightKg }),
          ...set(dto.division, { division: dto.division }),
          ...set(dto.coreActivity, { coreActivity: dto.coreActivity }),
          ...set(dto.majorGroup, { majorGroup: dto.majorGroup }),
          ...set(dto.brandName, { brandName: dto.brandName }),
          ...set(dto.effectiveDate, { effectiveDate: toDate(dto.effectiveDate) }),
          ...set(dto.customerStockNo, { customerStockNo: dto.customerStockNo }),
          ...set(dto.stockToBe, { stockToBe: dto.stockToBe }),
          ...set(dto.stockDioDays, { stockDioDays: dto.stockDioDays }),
          ...set(dto.contractItemsFor, { contractItemsFor: dto.contractItemsFor }),

          ...set(dto.preferredVendorId, {
            preferredVendorId: dto.preferredVendorId
              ? parseBigIntId(dto.preferredVendorId, 'preferredVendorId')
              : null,
          }),
          ...set(dto.storeCategoryId, {
            storeCategoryId: dto.storeCategoryId
              ? parseBigIntId(dto.storeCategoryId, 'storeCategoryId')
              : null,
          }),
          ...set(dto.itemGroupId, {
            itemGroupId: dto.itemGroupId ? parseBigIntId(dto.itemGroupId, 'itemGroupId') : null,
          }),
          ...set(dto.inventoryUomId, {
            inventoryUomId: dto.inventoryUomId ? parseBigIntId(dto.inventoryUomId, 'inventoryUomId') : null,
          }),
          ...set(dto.valuationMethod, { valuationMethod: dto.valuationMethod }),
          ...set(dto.itemCost, { itemCost: dto.itemCost }),
          ...set(dto.manageStockByWarehouse, {
            manageStockByWarehouse: dto.manageStockByWarehouse,
          }),

          ...set(dto.remarks, { remarks: dto.remarks }),
          ...set(dto.purchase, {
            purchaseJson: mergeJsonBag(existing?.purchaseJson, dto.purchase),
          }),
          ...set(dto.sales, {
            salesJson: mergeJsonBag(existing?.salesJson, dto.sales),
          }),
          ...set(dto.inventory, {
            inventoryJson: mergeJsonBag(existing?.inventoryJson, dto.inventory),
          }),
          ...set(dto.planning, {
            planningJson: mergeJsonBag(existing?.planningJson, dto.planning),
          }),
          ...set(dto.production, {
            productionJson: mergeJsonBag(existing?.productionJson, dto.production),
          }),
          ...set(dto.properties, {
            propertiesJson: mergeJsonBag(existing?.propertiesJson, dto.properties),
          }),
          ...set(dto.attachments, {
            attachmentsJson: dto.attachments as Prisma.InputJsonValue | undefined,
          }),
          ...set(dto.metadata, {
            metadata: mergeJsonBag(existing?.metadata, dto.metadata),
          }),
          ...set(dto.isActive, { isActive: dto.isActive }),

          updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
          updatedAt: new Date(),
        },
        include: WAREHOUSE_STOCK_INCLUDE,
      });
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.item.update({
      where: { itemId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }

  upsertWarehouseStock(
    companyId: string,
    itemId: string,
    dto: UpsertItemWarehouseStockDto,
    actorId?: string,
  ) {
    const itemKey = parseBigIntId(itemId);
    const warehouseKey = parseBigIntId(dto.warehouseId, 'warehouseId');
    const actorKey = actorId ? parseBigIntId(actorId) : undefined;

    return this.prisma.itemWarehouseStock.upsert({
      where: { itemId_warehouseId: { itemId: itemKey, warehouseId: warehouseKey } },
      create: {
        companyId: parseBigIntId(companyId),
        itemId: itemKey,
        warehouseId: warehouseKey,
        isLocked: dto.isLocked ?? false,
        qtyCommitted: dto.qtyCommitted ?? 0,
        qtyOrdered: dto.qtyOrdered ?? 0,
        requiredQty: dto.requiredQty ?? null,
        minimumQty: dto.minimumQty ?? null,
        maximumQty: dto.maximumQty ?? null,
        firstBinLocation: dto.firstBinLocation ?? null,
        defaultBinLocation: dto.defaultBinLocation ?? null,
        enforceDefaultBin: dto.enforceDefaultBin ?? false,
        createdBy: actorKey,
      },
      update: {
        ...(dto.isLocked !== undefined ? { isLocked: dto.isLocked } : {}),
        ...(dto.qtyCommitted !== undefined ? { qtyCommitted: dto.qtyCommitted } : {}),
        ...(dto.qtyOrdered !== undefined ? { qtyOrdered: dto.qtyOrdered } : {}),
        ...(dto.requiredQty !== undefined ? { requiredQty: dto.requiredQty } : {}),
        ...(dto.minimumQty !== undefined ? { minimumQty: dto.minimumQty } : {}),
        ...(dto.maximumQty !== undefined ? { maximumQty: dto.maximumQty } : {}),
        ...(dto.firstBinLocation !== undefined
          ? { firstBinLocation: dto.firstBinLocation }
          : {}),
        ...(dto.defaultBinLocation !== undefined
          ? { defaultBinLocation: dto.defaultBinLocation }
          : {}),
        ...(dto.enforceDefaultBin !== undefined
          ? { enforceDefaultBin: dto.enforceDefaultBin }
          : {}),
        updatedBy: actorKey,
        updatedAt: new Date(),
      },
      include: {
        warehouse: {
          select: { warehouseId: true, warehouseCode: true, name: true },
        },
      },
    });
  }

  async hasStockInWarehouse(itemId: string, warehouseId: string) {
    const row = await this.prisma.stockBalance.findFirst({
      where: {
        itemId: parseBigIntId(itemId),
        warehouseId: parseBigIntId(warehouseId, 'warehouseId'),
        quantity: { not: 0 },
      },
      select: { stockBalanceId: true },
    });
    return Boolean(row);
  }

  deleteWarehouseStock(itemId: string, warehouseId: string) {
    return this.prisma.itemWarehouseStock.deleteMany({
      where: {
        itemId: parseBigIntId(itemId),
        warehouseId: parseBigIntId(warehouseId, 'warehouseId'),
      },
    });
  }
}
