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
  SERIAL_QTY_MUST_BE_ONE: 'INVENTORY_SERIAL_QTY_MUST_BE_ONE',
  UOM_MISMATCH: 'INVENTORY_UOM_MISMATCH',
  UOM_DECIMAL_PRECISION: 'INVENTORY_UOM_DECIMAL_PRECISION',
  LOCATION_NOT_FOUND: 'INVENTORY_LOCATION_NOT_FOUND',
  LOCATION_INACTIVE: 'INVENTORY_LOCATION_INACTIVE',
  SITE_NOT_FOUND: 'INVENTORY_SITE_NOT_FOUND',
  SITE_LOCATION_MISMATCH: 'INVENTORY_SITE_LOCATION_MISMATCH',
  BIN_REQUIRED: 'INVENTORY_BIN_REQUIRED',
  BIN_NOT_ALLOWED: 'INVENTORY_BIN_NOT_ALLOWED',
  BIN_NOT_FOUND: 'INVENTORY_BIN_NOT_FOUND',
  BIN_INACTIVE: 'INVENTORY_BIN_INACTIVE',
  BIN_BLOCKED: 'INVENTORY_BIN_BLOCKED',
  BIN_SAME: 'INVENTORY_TRANSFER_SAME_BIN',
  TO_BIN_REQUIRED: 'INVENTORY_TO_BIN_REQUIRED',
  DUPLICATE_LINE: 'INVENTORY_DUPLICATE_LINE',
  OUT_OF_SCOPE: 'INVENTORY_LOCATION_OUT_OF_SCOPE',
  VENDOR_INACTIVE: 'VENDOR_INACTIVE',
  SUBCONTRACTOR_NO_ISSUE: 'SUBCONTRACTOR_STOCK_NOT_ISSUABLE',
  TRANSFER_BIN_MGMT_REQUIRED: 'INVENTORY_TRANSFER_BIN_MGMT_REQUIRED',
} as const;

/** Fallback when UoM master has no row / decimalPlaces not loaded. */
export function defaultUomDecimalPlaces(code: string | null | undefined): number {
  const c = (code ?? '').trim().toUpperCase();
  if (!c) return 6;
  if (['NOS', 'PCS', 'PC', 'EA', 'SET', 'PAIR', 'UNIT', 'UNITS'].includes(c)) return 0;
  if (
    ['KG', 'G', 'MTR', 'M', 'METER', 'METRE', 'MM', 'CM', 'LTR', 'L', 'LITRE', 'LITER', 'ML', 'SQ.M', 'SQM', 'M2'].includes(
      c,
    )
  ) {
    return 3;
  }
  return 6;
}

export function quantityFractionDigits(quantity: string): number {
  const normalized = quantity.trim();
  const dot = normalized.indexOf('.');
  if (dot < 0) return 0;
  return normalized.length - dot - 1;
}

export interface ResolvedInventoryLine extends StockLocationKey {
  lineNo: number;
  itemCode: string;
  itemName: string;
  uom: string | null;
  /** From UoM master (0–6); FE uses for qty input precision. */
  uomDecimalPlaces: number;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  physicalQuantity: Prisma.Decimal | null;
  remarks: string | null;
  batchNo: string | null;
  serialNo: string | null;
  brand: string | null;
  zeroPriceConfirmed: boolean;
  /** Stock Transfer destination bin (same warehouse). */
  toStorageBinId: bigint | null;
}

/** Inventory UoM lives in the Item Master inventory tab bag. */
export function itemInventoryUom(inventoryJson: Prisma.JsonValue | null): string | null {
  if (!inventoryJson || typeof inventoryJson !== 'object' || Array.isArray(inventoryJson)) return null;
  const uom = (inventoryJson as Record<string, unknown>).uomName;
  return typeof uom === 'string' && uom.trim() ? uom.trim().slice(0, 40) : null;
}

/**
 * Document GET display UoM: always prefer live Item Master (relation or inventoryJson),
 * then fall back to the line stamp. Used for draft and posted document responses.
 */
export function displayItemMasterUom(
  item: {
    inventoryUom?: { code?: string | null } | null;
    inventoryJson?: Prisma.JsonValue | null;
  },
  lineUom: string | null | undefined,
): string | null {
  const fromMaster =
    item.inventoryUom?.code?.trim() || itemInventoryUom(item.inventoryJson ?? null);
  return fromMaster || (lineUom?.trim() ? lineUom.trim() : null) || null;
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
          inventoryUom: { select: { code: true, decimalPlaces: true } },
        },
      }),
      db.warehouse.findMany({
        where: { companyId: company, warehouseId: { in: ids(warehouseIdOf) }, deletedAt: null },
        select: {
          warehouseId: true,
          branchId: true,
          binManagement: true,
          isActive: true,
          vendor: { select: { name: true, isActive: true, deletedAt: true } },
          storeCategory: { select: { storeType: true } },
        },
      }),
      db.branch.findMany({
        where: { companyId: company, branchId: { in: ids(siteIdOf) }, deletedAt: null, isActive: true },
        select: { branchId: true },
      }),
      db.storageBin.findMany({
        where: {
          companyId: company,
          storageBinId: {
            in: [
              ...ids((l) => l.storageBinId),
              ...ids((l) => (l as InventoryDocumentLineInput & { toStorageBinId?: string | null }).toStorageBinId),
            ],
          },
          deletedAt: null,
        },
        select: { storageBinId: true, warehouseId: true, isActive: true, status: true },
      }),
      this.dataAccessPoliciesService.resolveUserDataScope(userId, companyId),
    ]);

    const itemById = new Map(items.map((i) => [i.itemId.toString(), i]));
    const warehouseById = new Map(warehouses.map((w) => [w.warehouseId.toString(), w]));
    const branchIds = new Set(branches.map((b) => b.branchId.toString()));
    const binById = new Map(bins.map((b) => [b.storageBinId.toString(), b]));
    const seen = new Set<string>();

    const assertBinUsable = (
      fail: (code: string, field: string, message: string) => never,
      binId: string | null | undefined,
      field: string,
      warehouseId: bigint,
      mode: 'inbound' | 'outbound',
    ): bigint => {
      if (!binId) {
        return fail(INVENTORY_LINE_ERROR_CODES.BIN_REQUIRED, field, 'Storage bin is required for this location') as never;
      }
      const bin = binById.get(binId);
      if (!bin || bin.warehouseId !== warehouseId) {
        return fail(
          INVENTORY_LINE_ERROR_CODES.BIN_NOT_FOUND,
          field,
          'Storage bin not found in this inventory location',
        ) as never;
      }
      const status = (bin.status || (bin.isActive ? 'ACTIVE' : 'INACTIVE')).toUpperCase();
      if (status === 'INACTIVE') {
        return fail(INVENTORY_LINE_ERROR_CODES.BIN_INACTIVE, field, 'Storage bin is inactive') as never;
      }
      if (mode === 'inbound' && status === 'BLOCKED') {
        return fail(
          INVENTORY_LINE_ERROR_CODES.BIN_BLOCKED,
          field,
          'Storage bin is blocked and cannot receive stock',
        ) as never;
      }
      return bin.storageBinId;
    };

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
      const uom = item.inventoryUom?.code?.trim() || itemInventoryUom(item.inventoryJson);
      const uomDecimalPlaces = Math.min(
        6,
        Math.max(0, item.inventoryUom?.decimalPlaces ?? defaultUomDecimalPlaces(uom)),
      );
      if (line.uom && line.uom.toLowerCase() !== (uom ?? '').toLowerCase()) {
        fail(
          INVENTORY_LINE_ERROR_CODES.UOM_MISMATCH,
          'uom',
          `UoM must be the Item Master inventory UoM (${uom ?? 'not set'})`,
        );
      }

      // Opening Stock: serial-tracked items allowed with qty = 1 per line (serialNo reference).
      // Batch-managed: allowed as reference text only (stock key still Part+Store+Bin).
      // Other documents: batch/serial stock not supported yet.
      if (item.manageBy !== 'none' && documentType !== InventoryDocumentType.OPENING_STOCK) {
        fail(
          INVENTORY_LINE_ERROR_CODES.ITEM_BATCH_SERIAL_NOT_SUPPORTED,
          'itemId',
          `${item.itemCode} is managed by ${item.manageBy}; batch/serial stock is not supported yet`,
        );
      }
      if (documentType === InventoryDocumentType.OPENING_STOCK && item.manageBy === 'serial' && line.quantity) {
        try {
          if (!new Prisma.Decimal(line.quantity.trim()).eq(1)) {
            fail(
              INVENTORY_LINE_ERROR_CODES.SERIAL_QTY_MUST_BE_ONE,
              'quantity',
              `${item.itemCode} is serial-tracked; quantity must be 1 per line`,
            );
          }
        } catch {
          fail(
            INVENTORY_LINE_ERROR_CODES.SERIAL_QTY_MUST_BE_ONE,
            'quantity',
            `${item.itemCode} is serial-tracked; quantity must be 1 per line`,
          );
        }
      }
      // Opening Stock: do not hard-block qty decimals by UoM precision (go-live).
      // Still return uomDecimalPlaces so FE can guide input; max 6 dp via Decimal column.

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
      if (warehouse.vendor && (!warehouse.vendor.isActive || warehouse.vendor.deletedAt)) {
        fail(
          INVENTORY_LINE_ERROR_CODES.VENDOR_INACTIVE,
          'inventoryLocationId',
          `Vendor ${warehouse.vendor.name} of this location is inactive`,
        );
      }
      // Material at job-work vendors leaves only through job-work receipt, return or adjustment.
      if (documentType === InventoryDocumentType.MATERIAL_ISSUE && warehouse.storeCategory?.storeType === 'SUBCONTRACTOR') {
        fail(
          INVENTORY_LINE_ERROR_CODES.SUBCONTRACTOR_NO_ISSUE,
          'inventoryLocationId',
          `Stock at vendor${warehouse.vendor ? ` ${warehouse.vendor.name}` : ''} cannot be issued`,
        );
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

      if (documentType === InventoryDocumentType.STOCK_TRANSFER && !warehouse.binManagement) {
        fail(
          INVENTORY_LINE_ERROR_CODES.TRANSFER_BIN_MGMT_REQUIRED,
          'inventoryLocationId',
          'Bin-to-bin transfer requires bin management on this location',
        );
      }

      let storageBinId: bigint | null = null;
      let toStorageBinId: bigint | null = null;
      const transferLine = line as InventoryDocumentLineInput & { toStorageBinId?: string | null };

      if (warehouse.binManagement) {
        if (documentType === InventoryDocumentType.STOCK_TRANSFER) {
          storageBinId = assertBinUsable(fail, line.storageBinId, 'storageBinId', warehouse.warehouseId, 'outbound');
          if (!transferLine.toStorageBinId) {
            fail(INVENTORY_LINE_ERROR_CODES.TO_BIN_REQUIRED, 'toStorageBinId', 'Destination storage bin is required');
          }
          toStorageBinId = assertBinUsable(
            fail,
            transferLine.toStorageBinId,
            'toStorageBinId',
            warehouse.warehouseId,
            'inbound',
          );
          if (storageBinId === toStorageBinId) {
            fail(INVENTORY_LINE_ERROR_CODES.BIN_SAME, 'toStorageBinId', 'From and to storage bins must be different');
          }
        } else {
          const inbound =
            documentType === InventoryDocumentType.OPENING_STOCK ||
            documentType === InventoryDocumentType.STOCK_ADJUSTMENT;
          storageBinId = assertBinUsable(
            fail,
            line.storageBinId,
            'storageBinId',
            warehouse.warehouseId,
            inbound ? 'inbound' : 'outbound',
          );
        }
      } else if (line.storageBinId || transferLine.toStorageBinId) {
        fail(
          INVENTORY_LINE_ERROR_CODES.BIN_NOT_ALLOWED,
          line.storageBinId ? 'storageBinId' : 'toStorageBinId',
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
        uomDecimalPlaces,
        branchId: warehouse.branchId,
        warehouseId: warehouse.warehouseId,
        storageBinId,
        toStorageBinId,
        quantity: decimalOrNull(line.quantity),
        unitPrice: decimalOrNull(line.unitPrice),
        physicalQuantity: decimalOrNull(line.physicalQuantity),
        remarks: line.remarks ?? null,
        batchNo: line.batchNo?.trim() || null,
        serialNo: line.serialNo?.trim() || null,
        brand: line.brand?.trim() || null,
        zeroPriceConfirmed: line.zeroPriceConfirmed === true,
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
      if (documentType === InventoryDocumentType.OPENING_STOCK) {
        // Many lines of the same part in one bin are allowed (blank or different brand /
        // batch). Posted stock still merges on Part + Store + Bin.
        // Only hard block: same serialNo twice for the same item in this document.
        if (resolved.serialNo) {
          const serialKey = `${resolved.itemId.toString()}:${resolved.serialNo.toLowerCase()}`;
          if (seen.has(`serial:${serialKey}`)) {
            fail(
              INVENTORY_LINE_ERROR_CODES.DUPLICATE_LINE,
              'serialNo',
              `Serial ${resolved.serialNo} of ${item.itemCode} is entered twice in this document`,
            );
          }
          seen.add(`serial:${serialKey}`);
        }
      }
      if (documentType === InventoryDocumentType.STOCK_TRANSFER) {
        const key = `${stockKey(resolved)}>${resolved.toStorageBinId}`;
        if (seen.has(key)) {
          fail(
            INVENTORY_LINE_ERROR_CODES.DUPLICATE_LINE,
            'itemId',
            `${item.itemCode} is transferred twice on the same from/to bins`,
          );
        }
        seen.add(key);
      }
      return resolved;
    });
  }
}
