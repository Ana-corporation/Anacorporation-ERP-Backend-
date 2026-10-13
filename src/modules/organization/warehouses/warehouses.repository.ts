import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, WarehouseLocationType } from '@prisma/client';
import { BusinessException, ConflictException } from '@/common/exceptions/business.exception';
import { STORE_CATEGORY_ERROR_CODES } from '../store-categories/store-categories.constants';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateWarehouseDto, UpdateWarehouseDto, WarehouseListQueryDto } from './dto/warehouse.dto';
import { LOCATION_CODE_PREFIX, LOCATION_CODE_SCOPE, formatLocationCode } from './store-code.util';

const CREATE_ATTEMPTS = 3;
const CODE_SKIP_LIMIT = 50;

const withStoreCategory = {
  storeCategory: { select: { storeCategoryId: true, name: true, codePrefix: true } },
  _count: { select: { storageBins: { where: { deletedAt: null, isActive: true } } } },
} satisfies Prisma.WarehouseInclude;

const WAREHOUSES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'warehouseCode', name: 'name' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['warehouseCode', 'name', 'address'],
  sortFields: ['warehouseCode', 'name', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class WarehousesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: WarehouseListQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const branchId = query.siteId || query.branchId;
    const where = buildListWhere(
      {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        ...(branchId ? { branchId: parseBigIntId(branchId) } : {}),
        ...(query.storeCategoryId ? { storeCategoryId: parseBigIntId(query.storeCategoryId) } : {}),
      },
      query,
      WAREHOUSES_LIST_FILTER,
    ) as Prisma.WarehouseWhereInput;

    return this.prisma.$transaction([
      this.prisma.warehouse.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, WAREHOUSES_LIST_FILTER),
        include: withStoreCategory,
      }),
      this.prisma.warehouse.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.warehouse.findFirst({
      where: { warehouseId: parseBigIntId(id), companyId: parseBigIntId(companyId), deletedAt: null },
      include: withStoreCategory,
    });
  }

  /** Non-deleted store category of this company (null when not found). */
  findStoreCategory(companyId: string, storeCategoryId: string) {
    return this.prisma.storeCategory.findFirst({
      where: { storeCategoryId: parseBigIntId(storeCategoryId), companyId: parseBigIntId(companyId), deletedAt: null },
      select: { storeCategoryId: true, isActive: true, codePrefix: true },
    });
  }

  countBins(warehouseId: string) {
    return this.prisma.storageBin.count({
      where: {
        warehouseId: parseBigIntId(warehouseId),
        deletedAt: null,
      },
    });
  }

  /** What references the location: bins, stock rows, ledger history, document lines (non-deleted docs). */
  async usage(warehouseId: string) {
    const id = parseBigIntId(warehouseId);
    const [bins, stockRows, unbinnedStock, ledgerEntries, documentLines] = await Promise.all([
      this.prisma.storageBin.count({ where: { warehouseId: id, deletedAt: null } }),
      this.prisma.stockBalance.count({ where: { warehouseId: id } }),
      this.prisma.stockBalance.count({ where: { warehouseId: id, binKey: 0n, quantity: { not: 0 } } }),
      this.prisma.stockLedgerEntry.count({ where: { warehouseId: id } }),
      this.prisma.inventoryDocumentLine.count({ where: { warehouseId: id, document: { deletedAt: null } } }),
    ]);
    return {
      bins,
      unbinnedStock,
      hasInventory: stockRows + ledgerEntries + documentLines > 0,
    };
  }

  findBranchAddress(companyId: string, branchId: string) {
    return this.prisma.branch.findFirst({
      where: { branchId: parseBigIntId(branchId), companyId: parseBigIntId(companyId), deletedAt: null },
      select: { address: true },
    });
  }

  /** One default location per site: clear the others in that site. */
  private clearSiteDefault(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    branchId: bigint,
    keepWarehouseId?: bigint,
  ) {
    return tx.warehouse.updateMany({
      where: {
        companyId,
        branchId,
        deletedAt: null,
        isDefault: true,
        ...(keepWarehouseId ? { NOT: { warehouseId: keepWarehouseId } } : {}),
      },
      data: { isDefault: false, updatedAt: new Date() },
    });
  }

  /**
   * Creates the location with a backend-generated code (PREFIX-NNN). The number comes from
   * company_code_sequences in the same transaction, so a rollback also releases the number.
   * The unique (company_id, warehouse_code) index is the final guard; a clash is retried.
   */
  async create(companyId: string, dto: CreateWarehouseDto, createdBy?: string) {
    const locationType = dto.locationType ?? WarehouseLocationType.Store;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.createOnce(companyId, { ...dto, locationType }, createdBy);
      } catch (error) {
        const clash =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!clash || attempt >= CREATE_ATTEMPTS) throw error;
      }
    }
  }

  private createOnce(
    companyId: string,
    dto: CreateWarehouseDto & { locationType: WarehouseLocationType },
    createdBy?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as Prisma.TransactionClient;
      const company = parseBigIntId(companyId);
      const storeCategoryId = dto.storeCategoryId ? parseBigIntId(dto.storeCategoryId) : null;
      const prefix = storeCategoryId
        ? await this.lockStoreCategoryPrefix(db, company, storeCategoryId)
        : LOCATION_CODE_PREFIX[dto.locationType];
      const warehouseCode = await this.nextLocationCode(db, company, prefix);

      if (dto.isDefault) {
        await this.clearSiteDefault(db, company, parseBigIntId(dto.branchId));
      }

      return tx.warehouse.create({
        data: {
          companyId: company,
          warehouseCode,
          name: dto.name.trim(),
          branchId: parseBigIntId(dto.branchId),
          storeCategoryId,
          address: dto.address,
          locationType: dto.locationType,
          binManagement: dto.binManagement ?? false,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
        include: withStoreCategory,
      });
    });
  }

  /**
   * Category prefix for a new location. FOR SHARE blocks a concurrent prefix change / delete of
   * the category (they take FOR UPDATE) until this location is committed.
   */
  private async lockStoreCategoryPrefix(tx: Prisma.TransactionClient, companyId: bigint, storeCategoryId: bigint) {
    const [category] = await tx.$queryRaw<Array<{ code_prefix: string; is_active: boolean }>>`
      SELECT code_prefix, is_active FROM store_categories
      WHERE store_category_id = ${storeCategoryId} AND company_id = ${companyId} AND deleted_at IS NULL
      FOR SHARE`;
    if (!category) {
      throw new BusinessException(
        'Store category not found',
        HttpStatus.NOT_FOUND,
        [{ field: 'storeCategoryId', message: 'Store category not found in this company' }],
        STORE_CATEGORY_ERROR_CODES.NOT_FOUND,
      );
    }
    if (!category.is_active) {
      throw new BusinessException(
        'Store category is inactive',
        HttpStatus.BAD_REQUEST,
        [{ field: 'storeCategoryId', message: 'Inactive categories cannot be used for new locations' }],
        STORE_CATEGORY_ERROR_CODES.INACTIVE,
      );
    }
    return category.code_prefix;
  }

  /**
   * Next free PREFIX-NNN for the company. The upsert row-locks the counter until commit, so
   * concurrent creates queue up. A new counter starts after the highest existing PREFIX-<n>
   * code (deleted rows included), so codes are never reused. Codes already taken (e.g. typed
   * in by hand before codes were generated) are skipped.
   */
  private async nextLocationCode(tx: Prisma.TransactionClient, companyId: bigint, prefix: string) {
    const pattern = `^${prefix}-(\\d{1,9})$`;
    for (let i = 0; i < CODE_SKIP_LIMIT; i++) {
      const [row] = await tx.$queryRaw<Array<{ last_number: number }>>`
        INSERT INTO company_code_sequences (company_id, scope, prefix, last_number, updated_at)
        VALUES (
          ${companyId}, ${LOCATION_CODE_SCOPE}, ${prefix},
          1 + COALESCE((
            SELECT MAX(substring(w.warehouse_code FROM ${pattern})::int)
            FROM warehouses w
            WHERE w.company_id = ${companyId} AND w.warehouse_code ~ ${pattern}
          ), 0),
          NOW()
        )
        ON CONFLICT (company_id, scope, prefix)
        DO UPDATE SET last_number = company_code_sequences.last_number + 1, updated_at = NOW()
        RETURNING last_number`;
      const code = formatLocationCode(prefix, row.last_number);
      const taken = await tx.warehouse.findFirst({
        where: { companyId, warehouseCode: code },
        select: { warehouseId: true },
      });
      if (!taken) return code;
    }
    throw new ConflictException('Could not generate a unique location code', 'WAREHOUSE_CODE_EXISTS');
  }

  /** effective = the location's site / default flag after this update. */
  update(
    id: string,
    companyId: string,
    dto: UpdateWarehouseDto,
    effective: { branchId: bigint | null; isDefault: boolean },
    updatedBy?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (effective.isDefault && effective.branchId) {
        await this.clearSiteDefault(
          tx as unknown as Prisma.TransactionClient,
          parseBigIntId(companyId),
          effective.branchId,
          parseBigIntId(id),
        );
      }

      return tx.warehouse.update({
        where: { warehouseId: parseBigIntId(id) },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.branchId !== undefined ? { branchId: parseBigIntId(dto.branchId) } : {}),
          ...(dto.storeCategoryId !== undefined
            ? { storeCategoryId: dto.storeCategoryId === null ? null : parseBigIntId(dto.storeCategoryId) }
            : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.locationType !== undefined ? { locationType: dto.locationType } : {}),
          ...(dto.binManagement !== undefined ? { binManagement: dto.binManagement } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
          updatedAt: new Date(),
        },
        include: withStoreCategory,
      });
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.warehouse.update({
      where: { warehouseId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
        isDefault: false,
      },
    });
  }
}
