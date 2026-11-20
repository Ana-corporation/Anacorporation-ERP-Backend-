import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { WarehousesRepository } from '@/modules/organization/warehouses/warehouses.repository';
import { InventoryDocumentLineInput } from './dto/inventory-document.dto';

export const SUBCONTRACTOR_ERROR_CODES = {
  STORE_INVALID: 'SUBCONTRACTOR_STORE_INVALID',
  VENDOR_REQUIRED: 'VENDOR_REQUIRED',
  VENDOR_NOT_ALLOWED: 'VENDOR_NOT_ALLOWED',
  VENDOR_NOT_FOUND: 'VENDOR_NOT_FOUND',
  VENDOR_INACTIVE: 'VENDOR_INACTIVE',
} as const;

type Field = { field: string; message: string };
const fail = (code: string, message: string, field: string): never => {
  throw new BusinessException(message, HttpStatus.BAD_REQUEST, [{ field, message } satisfies Field], code);
};

/**
 * Users pick ONE "Sub Contractor Store" (Store Type SUBCONTRACTOR) plus a Vendor; stock is kept in
 * that vendor's own location inside the store, created on first use. This maps lines to those
 * locations inside the caller's transaction, so stock keys stay item + location + bin.
 */
@Injectable()
export class SubcontractorLocationService {
  constructor(private readonly warehouses: WarehousesRepository) {}

  /** The company's active Sub Contractor store, or an error for the given field. */
  async requireStore(db: Prisma.TransactionClient, companyId: bigint, storeCategoryId: string, field: string) {
    const store = await db.storeCategory.findFirst({
      where: { storeCategoryId: BigInt(storeCategoryId), companyId, deletedAt: null },
      select: { storeCategoryId: true, name: true, storeType: true, isActive: true },
    });
    if (!store || store.storeType !== 'SUBCONTRACTOR' || !store.isActive) {
      fail(SUBCONTRACTOR_ERROR_CODES.STORE_INVALID, 'Store is not an active Sub Contractor store of this company', field);
    }
    return store!;
  }

  /** Active vendor of the company, or an error for the given field. */
  async requireVendor(db: Prisma.TransactionClient, companyId: bigint, vendorId: string, field: string) {
    const vendor = await db.vendor.findFirst({
      where: { vendorId: BigInt(vendorId), companyId, deletedAt: null },
      select: { vendorId: true, name: true, isActive: true },
    });
    if (!vendor) fail(SUBCONTRACTOR_ERROR_CODES.VENDOR_NOT_FOUND, 'Vendor not found in this company', field);
    if (!vendor!.isActive) fail(SUBCONTRACTOR_ERROR_CODES.VENDOR_INACTIVE, `Vendor ${vendor!.name} is inactive`, field);
    return vendor!;
  }

  /**
   * Lines with storeCategoryId (Sub Contractor store) get the vendor's location as their location;
   * vendorId on any other line is rejected unless it already is that vendor's location.
   */
  async mapLines(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    lines: InventoryDocumentLineInput[],
    actorId: string,
  ): Promise<InventoryDocumentLineInput[]> {
    const out: InventoryDocumentLineInput[] = [];
    for (const [i, line] of lines.entries()) {
      const path = `lines[${i}]`;
      if (line.storeCategoryId) {
        await this.requireStore(tx, companyId, line.storeCategoryId, `${path}.storeCategoryId`);
        if (!line.vendorId) fail(SUBCONTRACTOR_ERROR_CODES.VENDOR_REQUIRED, 'Vendor is required for the Sub Contractor store', `${path}.vendorId`);
        const vendor = await this.requireVendor(tx, companyId, line.vendorId!, `${path}.vendorId`);
        const warehouseId = await this.warehouses.findOrCreateVendorLocation(
          tx,
          companyId,
          BigInt(line.storeCategoryId),
          vendor,
          actorId ? BigInt(actorId) : null,
        );
        out.push({ ...line, inventoryLocationId: warehouseId.toString(), warehouseId: undefined, storageBinId: line.storageBinId ?? null });
        continue;
      }
      if (line.vendorId) {
        const locationId = line.inventoryLocationId || line.warehouseId;
        const location = locationId
          ? await tx.warehouse.findFirst({ where: { warehouseId: BigInt(locationId), companyId, deletedAt: null }, select: { vendorId: true } })
          : null;
        if (!location || location.vendorId?.toString() !== line.vendorId) {
          fail(SUBCONTRACTOR_ERROR_CODES.VENDOR_NOT_ALLOWED, 'Vendor is only allowed for the Sub Contractor store', `${path}.vendorId`);
        }
      }
      out.push(line);
    }
    return out;
  }
}
