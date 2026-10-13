import { HttpStatus, Injectable } from '@nestjs/common';
import { InventoryDocumentType, Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { InventoryDocumentLineInput } from './dto/inventory-document.dto';
import { StockLocationKey, stockKey } from './stock-posting.service';

export const INVENTORY_LINE_ERROR_CODES = {
  ITEM_NOT_FOUND: 'INVENTORY_ITEM_NOT_FOUND',
  ITEM_NOT_STOCKABLE: 'INVENTORY_ITEM_NOT_STOCKABLE',
  ITEM_BATCH_SERIAL_NOT_SUPPORTED: 'INVENTORY_ITEM_BATCH_SERIAL_NOT_SUPPORTED',
  UOM_MISMATCH: 'INVENTORY_UOM_MISMATCH',
  LOCATION_NOT_FOUND: 'INVENTORY_LOCATION_NOT_FOUND',
  LOCATION_INACTIVE: 'INVENTORY_LOCATION_INACTIVE',
  SITE_NOT_FOUND: 'INVENTORY_SITE_NOT_FOUND',
  SITE_LOCATION_MISMATCH: 'INVENTORY_SITE_LOCATION_MISMATCH',
  BIN_REQUIRED: 'INVENTORY_BIN_REQUIRED',
  BIN_NOT_ALLOWED: 'INVENTORY_BIN_NOT_ALLOWED',
  BIN_NOT_FOUND: 'INVENTORY_BIN_NOT_FOUND',
  BIN_INACTIVE: 'INVENTORY_BIN_INACTIVE',
  DUPLICATE_LINE: 'INVENTORY_DUPLICATE_LINE',
  OUT_OF_SCOPE: 'INVENTORY_LOCATION_OUT_OF_SCOPE',
} as const;

export interface ResolvedInventoryLine extends StockLocationKey {
  lineNo: number;
  itemCode: string;
  itemName: string;
  uom: string | null;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  physicalQuantity: Prisma.Decimal | null;
  remarks: string | null;
}

/** Inventory UoM lives in the Item Master inventory tab bag. */
export function itemInventoryUom(inventoryJson: Prisma.JsonValue | null): string | null {
  if (!inventoryJson || typeof inventoryJson !== 'object' || Array.isArray(inventoryJson)) return null;
  const uom = (inventoryJson as Record<string, unknown>).uomName;
  return typeof uom === 'string' && uom.trim() ? uom.trim().slice(0, 40) : null;
}

const decimalOrNull = (value: string | undefined) =>
  value === undefined || value === '' ? null : new Prisma.Decimal(value);

/**
 * Checks every line against this company's masters: active stock item (no batch/serial yet),
 * Site → Inventory Location → Storage Bin hierarchy, UoM and the user's data access scope.
 * Runs on save and again inside the posting transaction.
 */
@Injectable()
export class InventoryLineResolverService {
  constructor(private readonly dataAccessPoliciesService: DataAccessPoliciesService) {}

  async resolve(
    db: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    documentType: InventoryDocumentType,
    lines: InventoryDocumentLineInput[],
  ): Promise<ResolvedInventoryLine[]> {
    const company = BigInt(companyId);
    const ids = (pick: (l: InventoryDocumentLineInput) => string | null | undefined) => [
      ...new Set(lines.map(pick).filter((id): id is string => Boolean(id)).map((id) => BigInt(id))),
    ];
    const warehouseIdOf = (l: InventoryDocumentLineInput) => l.inventoryLocationId || l.warehouseId;
    const siteIdOf = (l: InventoryDocumentLineInput) => l.siteId || l.branchId;

    const [items, warehouses, branches, bins, scope] = await Promise.all([
      db.item.findMany({
        where: { companyId: company, itemId: { in: ids((l) => l.itemId) }, deletedAt: null },
        select: {
          itemId: true,
          itemCode: true,
          description: true,
          isInventoryItem: true,
          isActive: true,
          status: true,
          manageBy: true,
          inventoryJson: true,
        },
      }),
      db.warehouse.findMany({
        where: { companyId: company, warehouseId: { in: ids(warehouseIdOf) }, deletedAt: null },
        select: { warehouseId: true, branchId: true, binManagement: true, isActive: true },
      }),
      db.branch.findMany({
        where: { companyId: company, branchId: { in: ids(siteIdOf) }, deletedAt: null, isActive: true },
        select: { branchId: true },
      }),
      db.storageBin.findMany({
        where: { companyId: company, storageBinId: { in: ids((l) => l.storageBinId) }, deletedAt: null },
        select: { storageBinId: true, warehouseId: true, isActive: true },
      }),
      this.dataAccessPoliciesService.resolveUserDataScope(userId, companyId),
    ]);

    const itemById = new Map(items.map((i) => [i.itemId.toString(), i]));
    const warehouseById = new Map(warehouses.map((w) => [w.warehouseId.toString(), w]));
    const branchIds = new Set(branches.map((b) => b.branchId.toString()));
    const binById = new Map(bins.map((b) => [b.storageBinId.toString(), b]));
    const seen = new Set<string>();

    return lines.map((line, index) => {
      const path = `lines[${index}]`;
      const fail = (code: string, field: string, message: string): never => {
        throw new BusinessException(
          message,
          HttpStatus.BAD_REQUEST,
          [{ field: `${path}.${field}`, message }],
          code,
        );
      };

      const item = itemById.get(line.itemId);
      if (!item) return fail(INVENTORY_LINE_ERROR_CODES.ITEM_NOT_FOUND, 'itemId', 'Item not found in this company');
      if (!item.isInventoryItem || !item.isActive || item.status === 'inactive') {
        fail(
          INVENTORY_LINE_ERROR_CODES.ITEM_NOT_STOCKABLE,
          'itemId',
          `${item.itemCode} is inactive or not an inventory item`,
        );
      }
      if (item.manageBy !== 'none') {
        fail(
          INVENTORY_LINE_ERROR_CODES.ITEM_BATCH_SERIAL_NOT_SUPPORTED,
          'itemId',
          `${item.itemCode} is managed by ${item.manageBy}; batch/serial stock is not supported yet`,
        );
      }
      const uom = itemInventoryUom(item.inventoryJson);
      if (line.uom && line.uom.toLowerCase() !== (uom ?? '').toLowerCase()) {
        fail(
          INVENTORY_LINE_ERROR_CODES.UOM_MISMATCH,
          'uom',
          `UoM must be the Item Master inventory UoM (${uom ?? 'not set'})`,
        );
      }

      const warehouse = warehouseById.get(warehouseIdOf(line)!);
      if (!warehouse) {
        return fail(
          INVENTORY_LINE_ERROR_CODES.LOCATION_NOT_FOUND,
          'inventoryLocationId',
          'Inventory location not found in this company',
        );
      }
      if (!warehouse.isActive) {
        fail(INVENTORY_LINE_ERROR_CODES.LOCATION_INACTIVE, 'inventoryLocationId', 'Inventory location is inactive');
      }
      const siteId = siteIdOf(line);
      if (siteId && !branchIds.has(siteId)) {
        fail(INVENTORY_LINE_ERROR_CODES.SITE_NOT_FOUND, 'siteId', 'Site not found or inactive');
      }
      if (siteId && siteId !== warehouse.branchId?.toString()) {
        fail(
          INVENTORY_LINE_ERROR_CODES.SITE_LOCATION_MISMATCH,
          'inventoryLocationId',
          'Inventory location does not belong to the selected site',
        );
      }

      let storageBinId: bigint | null = null;
      if (warehouse.binManagement) {
        if (!line.storageBinId) {
          fail(INVENTORY_LINE_ERROR_CODES.BIN_REQUIRED, 'storageBinId', 'Storage bin is required for this location');
        }
        const bin = binById.get(line.storageBinId!);
        if (!bin || bin.warehouseId !== warehouse.warehouseId) {
          fail(
            INVENTORY_LINE_ERROR_CODES.BIN_NOT_FOUND,
            'storageBinId',
            'Storage bin not found in this inventory location',
          );
        }
        if (!bin!.isActive) {
          fail(INVENTORY_LINE_ERROR_CODES.BIN_INACTIVE, 'storageBinId', 'Storage bin is inactive');
        }
        storageBinId = BigInt(line.storageBinId!);
      } else if (line.storageBinId) {
        fail(
          INVENTORY_LINE_ERROR_CODES.BIN_NOT_ALLOWED,
          'storageBinId',
          'This inventory location does not use storage bins',
        );
      }

      // Same rule as DataAccessPoliciesService.assertWarehouseScope (Item Master warehouse tab).
      if (scope.isRestricted && !scope.warehouseIds.includes(warehouse.warehouseId.toString())) {
        throw new BusinessException(
          'Access denied: inventory location is out of your policy scope',
          HttpStatus.FORBIDDEN,
          [{ field: `${path}.inventoryLocationId`, message: 'Out of your data access scope' }],
          INVENTORY_LINE_ERROR_CODES.OUT_OF_SCOPE,
        );
      }

      const resolved: ResolvedInventoryLine = {
        lineNo: index + 1,
        itemId: item.itemId,
        itemCode: item.itemCode,
        itemName: item.description,
        uom,
        branchId: warehouse.branchId,
        warehouseId: warehouse.warehouseId,
        storageBinId,
        quantity: decimalOrNull(line.quantity),
        unitPrice: decimalOrNull(line.unitPrice),
        physicalQuantity: decimalOrNull(line.physicalQuantity),
        remarks: line.remarks ?? null,
      };

      if (documentType === InventoryDocumentType.STOCK_ADJUSTMENT) {
        const key = stockKey(resolved);
        if (seen.has(key)) {
          fail(
            INVENTORY_LINE_ERROR_CODES.DUPLICATE_LINE,
            'itemId',
            `${item.itemCode} is counted twice for the same location and bin`,
          );
        }
        seen.add(key);
      }
      return resolved;
    });
  }
}
