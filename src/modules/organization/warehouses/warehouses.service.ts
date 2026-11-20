import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType, UserAuditAction, Warehouse } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { StockPostingService } from '@/modules/inventory/stock/stock-posting.service';
import { BranchesRepository } from '../branches/branches.repository';
import { CreateWarehouseDto, UpdateWarehouseDto, WarehouseListQueryDto } from './dto/warehouse.dto';
import { WarehousesRepository } from './warehouses.repository';
import { STORE_CATEGORY_ERROR_CODES } from '../store-categories/store-categories.constants';

export const WAREHOUSE_ERROR_CODES = {
  HAS_BINS: 'LOCATION_HAS_BINS',
  HAS_BINNED_STOCK: 'LOCATION_HAS_BINNED_STOCK',
  HAS_UNBINNED_STOCK: 'LOCATION_HAS_UNBINNED_STOCK',
  NEEDS_MIGRATE_CONFIRM: 'LOCATION_BIN_MIGRATE_CONFIRM_REQUIRED',
  IN_USE: 'LOCATION_IN_USE',
  SITE_LOCKED: 'LOCATION_SITE_LOCKED',
  CATEGORY_LOCKED: 'LOCATION_CATEGORY_LOCKED',
  SUBCONTRACTOR_AUTO: 'LOCATION_SUBCONTRACTOR_AUTO',
} as const;

export const UNASSIGNED_BIN_CODE = 'UNASSIGNED';
const BIN_MIGRATE_SOURCE = 'BIN_MGMT_MIGRATE';

/** locationCode = warehouseCode (Inventory Location screen name); both are returned. binCount = active bins. */
const withLocationCode = <T extends Pick<Warehouse, 'warehouseCode'> & { _count?: { storageBins: number } }>({
  _count,
  ...warehouse
}: T) => ({
  ...warehouse,
  locationCode: warehouse.warehouseCode,
  binCount: _count?.storageBins ?? 0,
});

@Injectable()
export class WarehousesService {
  constructor(
    private readonly repository: WarehousesRepository,
    private readonly branchesRepository: BranchesRepository,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly stockPosting: StockPostingService,
  ) {}

  private async validateBranch(companyId: string, branchId?: string | null, required = false) {
    if (!branchId) {
      if (required) {
        throw new BusinessException('branchId is required', HttpStatus.BAD_REQUEST, undefined, 'BRANCH_REQUIRED');
      }
      return;
    }
    const branch = await this.branchesRepository.findById(branchId, companyId);
    if (!branch) throw new NotFoundException('Branch');
  }

  /** Vendor of a sub-contractor location: must be an active vendor of this company. */
  private async validateVendor(companyId: string, vendorId?: string | null) {
    if (!vendorId) return;
    if (!(await this.repository.findActiveVendor(companyId, vendorId))) {
      throw new BusinessException(
        'Vendor not found or inactive',
        HttpStatus.BAD_REQUEST,
        [{ field: 'vendorId', message: 'Select an active vendor' }],
        'VENDOR_INACTIVE',
      );
    }
  }

  async findAll(companyId: string, query: WarehouseListQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    const pageResult = serialize(toPaginatedResult(items.map(withLocationCode), total, page, limit));
    const withAudit = await this.auditService.withAuditList(
      pageResult.items as unknown as Record<string, unknown>[],
    );
    return { ...pageResult, items: withAudit };
  }

  async findOne(id: string, companyId: string) {
    const warehouse = await this.repository.findById(id, companyId);
    if (!warehouse) throw new NotFoundException('Warehouse');
    return this.toResponse(warehouse);
  }

  /** Changing category never changes the code. An inactive category is allowed only if already set. */
  private async validateStoreCategoryChange(
    companyId: string,
    current: bigint | null,
    next: string | null | undefined,
  ) {
    if (!next || (current !== null && BigInt(next) === current)) return;
    const category = await this.repository.findStoreCategory(companyId, next);
    if (!category) {
      throw new BusinessException(
        'Store category not found',
        HttpStatus.NOT_FOUND,
        [{ field: 'storeCategoryId', message: 'Store category not found in this company' }],
        STORE_CATEGORY_ERROR_CODES.NOT_FOUND,
      );
    }
    if (!category.isActive) {
      throw new BusinessException(
        'Store category is inactive',
        HttpStatus.BAD_REQUEST,
        [{ field: 'storeCategoryId', message: 'Inactive categories cannot be newly assigned' }],
        STORE_CATEGORY_ERROR_CODES.INACTIVE,
      );
    }
  }

  private toResponse(warehouse: Pick<Warehouse, 'warehouseCode'>) {
    return this.auditService.withAudit(serialize(withLocationCode(warehouse)) as Record<string, unknown>);
  }

  async create(companyId: string, dto: CreateWarehouseDto, actorId: string) {
    await this.validateBranch(companyId, dto.branchId, true);
    await this.validateVendor(companyId, dto.vendorId);
    if (dto.storeCategoryId) {
      const store = await this.repository.findStoreCategory(companyId, dto.storeCategoryId);
      if (store?.storeType === 'SUBCONTRACTOR') {
        throw new BusinessException(
          'Locations of the Sub Contractor store are created automatically, one per vendor',
          HttpStatus.BAD_REQUEST,
          [{ field: 'storeCategoryId', message: 'Pick the Sub Contractor store and a Vendor on the document instead' }],
          WAREHOUSE_ERROR_CODES.SUBCONTRACTOR_AUTO,
        );
      }
    }

    const address = dto.address?.trim()
      ? dto.address
      : ((await this.repository.findBranchAddress(companyId, dto.branchId))?.address ?? undefined);
    const warehouse = await this.repository.create(companyId, { ...dto, address }, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Warehouse',
      entityId: warehouse.warehouseId.toString(),
      newValue: {
        warehouseCode: warehouse.warehouseCode,
        name: warehouse.name,
        storeCategoryId: warehouse.storeCategoryId,
        locationType: warehouse.locationType,
        binManagement: warehouse.binManagement,
        isDefault: warehouse.isDefault,
        vendorId: warehouse.vendorId,
        autoGenerated: true,
      },
    });

    return this.toResponse(warehouse);
  }

  async update(id: string, companyId: string, dto: UpdateWarehouseDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Warehouse');
    await this.validateBranch(companyId, dto.branchId);
    await this.validateVendor(companyId, dto.vendorId);
    await this.validateStoreCategoryChange(companyId, existing.storeCategoryId, dto.storeCategoryId);
    const binChange = await this.assertAllowedChanges(id, companyId, existing, dto, actorId);

    const { confirmMigrateToUnassigned: _confirm, ...persistDto } = dto;
    const warehouse = await this.repository.update(
      id,
      companyId,
      persistDto,
      {
        branchId: dto.branchId ? BigInt(dto.branchId) : existing.branchId,
        isDefault: dto.isDefault ?? existing.isDefault,
      },
      actorId,
    );

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Warehouse',
      entityId: id,
      oldValue: binChange
        ? { binManagement: existing.binManagement }
        : undefined,
      newValue: {
        ...(persistDto as Record<string, unknown>),
        ...(binChange
          ? {
              binManagement: dto.binManagement,
              migratedToUnassigned: binChange.migratedLines,
              unassignedBinId: binChange.unassignedBinId,
            }
          : {}),
      },
    });

    return this.toResponse(warehouse);
  }

  /**
   * Site / store category are fixed once the location has bins, stock or inventory documents.
   * Bin Mgmt OFF blocked while any bin has qty. Bin Mgmt ON with unbinned stock requires
   * confirmMigrateToUnassigned → move balances into system UNASSIGNED bin.
   */
  private async assertAllowedChanges(
    id: string,
    companyId: string,
    existing: Pick<Warehouse, 'warehouseId' | 'branchId' | 'storeCategoryId' | 'binManagement'>,
    dto: UpdateWarehouseDto,
    actorId: string,
  ): Promise<{ migratedLines: number; unassignedBinId: string | null } | null> {
    const siteChanging = dto.branchId !== undefined && dto.branchId !== existing.branchId?.toString();
    const categoryChanging =
      dto.storeCategoryId !== undefined && (dto.storeCategoryId ?? null) !== (existing.storeCategoryId?.toString() ?? null);
    const binsOff = dto.binManagement === false && existing.binManagement;
    const binsOn = dto.binManagement === true && !existing.binManagement;
    if (!siteChanging && !categoryChanging && !binsOff && !binsOn) return null;

    const usage = await this.repository.usage(id);
    const inUse = usage.bins > 0 || usage.hasInventory;
    if (siteChanging && inUse) {
      throw new BusinessException(
        'Site cannot change after the location has bins, stock or inventory documents',
        HttpStatus.BAD_REQUEST,
        [{ field: 'branchId', message: 'Location is already in use' }],
        WAREHOUSE_ERROR_CODES.SITE_LOCKED,
      );
    }
    if (categoryChanging && inUse) {
      throw new BusinessException(
        'Store category cannot change after the location has bins, stock or inventory documents',
        HttpStatus.BAD_REQUEST,
        [{ field: 'storeCategoryId', message: 'Location is already in use' }],
        WAREHOUSE_ERROR_CODES.CATEGORY_LOCKED,
      );
    }
    if (binsOff) {
      const hasBinned = await this.stockPosting.warehouseHasBinnedStock(
        this.prisma as unknown as Prisma.TransactionClient,
        existing.warehouseId,
      );
      if (hasBinned) {
        throw new BusinessException(
          'Cannot disable bin management while any storage bin still holds stock',
          HttpStatus.BAD_REQUEST,
          [{ field: 'binManagement', message: 'Transfer or issue stock out of bins first' }],
          WAREHOUSE_ERROR_CODES.HAS_BINNED_STOCK,
        );
      }
      return { migratedLines: 0, unassignedBinId: null };
    }
    if (binsOn) {
      if (usage.unbinnedStock > 0 && dto.confirmMigrateToUnassigned !== true) {
        throw new BusinessException(
          'Enabling bin management will move unbinned stock into the UNASSIGNED system bin. Confirm to continue.',
          HttpStatus.BAD_REQUEST,
          [
            {
              field: 'confirmMigrateToUnassigned',
              message: 'Set confirmMigrateToUnassigned=true to migrate unbinned stock to UNASSIGNED',
            },
          ],
          WAREHOUSE_ERROR_CODES.NEEDS_MIGRATE_CONFIRM,
        );
      }
      if (usage.unbinnedStock > 0) {
        const result = await this.migrateUnbinnedToUnassigned(companyId, id, actorId);
        return result;
      }
      return { migratedLines: 0, unassignedBinId: null };
    }
    return null;
  }

  /** Moves every unbinned balance into UNASSIGNED (system bin). Part+Store totals unchanged. */
  private async migrateUnbinnedToUnassigned(companyId: string, warehouseId: string, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const warehouse = parseBigIntId(warehouseId);
    const actor = parseBigIntId(actorId);

    return this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as Prisma.TransactionClient;
      const location = await db.warehouse.findFirst({
        where: { warehouseId: warehouse, companyId: company, deletedAt: null },
        select: { warehouseId: true, branchId: true },
      });
      if (!location) throw new NotFoundException('Warehouse');

      let unassigned = await db.storageBin.findFirst({
        where: { warehouseId: warehouse, binCode: UNASSIGNED_BIN_CODE, deletedAt: null },
        select: { storageBinId: true, isSystem: true },
      });
      if (!unassigned) {
        unassigned = await db.storageBin.create({
          data: {
            companyId: company,
            warehouseId: warehouse,
            binCode: UNASSIGNED_BIN_CODE,
            binName: 'Unassigned',
            isActive: true,
            status: 'ACTIVE',
            isSystem: true,
            createdBy: actor,
          },
          select: { storageBinId: true, isSystem: true },
        });
      } else if (!unassigned.isSystem) {
        await db.storageBin.update({
          where: { storageBinId: unassigned.storageBinId },
          data: { isSystem: true, status: 'ACTIVE', isActive: true, updatedAt: new Date(), updatedBy: actor },
        });
      }

      const balances = await this.stockPosting.unbinnedBalancesWithStock(db, warehouse);
      if (balances.length === 0) {
        return { migratedLines: 0, unassignedBinId: unassigned.storageBinId.toString() };
      }

      const now = new Date();
      const docNumber = `BIN-MIGRATE-${warehouseId}`;
      const movements = balances.flatMap((row, index) => {
        const qty = new Prisma.Decimal(row.quantity);
        const label = row.item.itemCode;
        const lineId = BigInt(index + 1);
        return [
          {
            sourceType: BIN_MIGRATE_SOURCE,
            sourceLineId: lineId,
            documentId: null,
            documentNumber: docNumber,
            transactionDate: now,
            movementType: StockMovementType.TRANSFER_OUT,
            itemId: row.itemId,
            branchId: row.branchId ?? location.branchId,
            warehouseId: row.warehouseId,
            storageBinId: null,
            quantity: qty.negated(),
            uom: null,
            label,
            errorField: 'binManagement',
          },
          {
            sourceType: BIN_MIGRATE_SOURCE,
            sourceLineId: lineId,
            documentId: null,
            documentNumber: docNumber,
            transactionDate: now,
            movementType: StockMovementType.TRANSFER_IN,
            itemId: row.itemId,
            branchId: row.branchId ?? location.branchId,
            warehouseId: row.warehouseId,
            storageBinId: unassigned!.storageBinId,
            quantity: qty,
            uom: null,
            label,
            errorField: 'binManagement',
          },
        ];
      });

      await this.stockPosting.applyMovements(db, company, actor, movements);
      return { migratedLines: balances.length, unassignedBinId: unassigned.storageBinId.toString() };
    });
  }

  async remove(id: string, companyId: string, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) throw new NotFoundException('Warehouse');

    const usage = await this.repository.usage(id);
    if (usage.bins > 0) {
      throw new BusinessException(
        'Cannot delete location while storage bins exist',
        HttpStatus.BAD_REQUEST,
        undefined,
        WAREHOUSE_ERROR_CODES.HAS_BINS,
      );
    }
    if (usage.hasInventory) {
      throw new BusinessException(
        'Location has stock or inventory documents; deactivate it instead',
        HttpStatus.CONFLICT,
        undefined,
        WAREHOUSE_ERROR_CODES.IN_USE,
      );
    }

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Warehouse',
      entityId: id,
    });

    return { message: 'Warehouse deleted' };
  }
}
