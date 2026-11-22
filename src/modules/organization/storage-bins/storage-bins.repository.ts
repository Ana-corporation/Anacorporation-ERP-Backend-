import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import {
  CreateStorageBinDto,
  STORAGE_BIN_LIST_MAX,
  StorageBinListQueryDto,
  UpdateStorageBinDto,
} from './dto/storage-bin.dto';

const STORAGE_BINS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'binCode', name: 'binName' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['binCode', 'binName'],
  sortFields: ['binCode', 'binName', 'createdAt'],
  defaultSortField: 'binCode',
};

/** A1-01 … A1-200 style: numeric-aware, not plain string order. */
export function compareBinCodes(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

@Injectable()
export class StorageBinsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyByCompany(companyId: string, query: StorageBinListQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(STORAGE_BIN_LIST_MAX, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;
    const locationId = query.inventoryLocationId || query.warehouseId;
    const base: Prisma.StorageBinWhereInput = {
      companyId: parseBigIntId(companyId),
      deletedAt: null,
      ...(locationId ? { warehouseId: parseBigIntId(locationId) } : {}),
    };
    const where = buildListWhere(base, query, STORAGE_BINS_LIST_FILTER) as Prisma.StorageBinWhereInput;
    const sortBy = query.sortBy || 'binCode';
    const sortOrder = query.sortOrder || 'asc';
    const natural = sortBy === 'binCode';

    // For a single store picker: load match set, natural-sort, then page (fixes A1-100 before A1-20).
    if (locationId && natural) {
      const all = await this.prisma.storageBin.findMany({ where });
      all.sort((a, b) => {
        const cmp = compareBinCodes(a.binCode, b.binCode);
        return sortOrder === 'desc' ? -cmp : cmp;
      });
      return {
        items: all.slice(skip, skip + limit),
        total: all.length,
        page,
        limit,
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.storageBin.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy({ ...query, sortBy, sortOrder }, STORAGE_BINS_LIST_FILTER),
      }),
      this.prisma.storageBin.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  findById(id: string, companyId: string) {
    return this.prisma.storageBin.findFirst({
      where: {
        storageBinId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  /** Includes deleted bins: the (warehouse_id, bin_code) unique index covers them too. */
  findByCode(warehouseId: string, binCode: string) {
    return this.prisma.storageBin.findFirst({
      where: {
        warehouseId: parseBigIntId(warehouseId),
        binCode,
      },
      select: { storageBinId: true, deletedAt: true },
    });
  }

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Prisma.TransactionClient));
  }

  /** skipDuplicates also covers codes inserted concurrently by another request. */
  createMany(
    db: Prisma.TransactionClient,
    companyId: bigint,
    warehouseId: bigint,
    bins: { binCode: string; binName?: string; isActive?: boolean }[],
    skipDuplicates: boolean,
    createdBy?: string,
  ) {
    return db.storageBin.createManyAndReturn({
      data: bins.map((bin) => {
        const status = bin.isActive === false ? 'INACTIVE' : 'ACTIVE';
        return {
          companyId,
          warehouseId,
          binCode: bin.binCode,
          binName: bin.binName?.trim() || null,
          status,
          isActive: status === 'ACTIVE',
          isSystem: false,
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        };
      }),
      skipDuplicates,
    });
  }

  /** Existing codes in the location, deleted ones included (they can't be reused either). */
  findCodes(db: Prisma.TransactionClient, warehouseId: bigint, binCodes: string[]) {
    return db.storageBin.findMany({
      where: { warehouseId, binCode: { in: binCodes } },
      select: { binCode: true, deletedAt: true },
    });
  }

  /** Stock / ledger / draft-or-posted document refs (from or to bin). */
  async usage(id: string) {
    const storageBinId = parseBigIntId(id);
    const [qtyRows, ledger, fromLines, toLines] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: { storageBinId, quantity: { not: 0 } },
        select: { quantity: true },
        take: 1,
      }),
      this.prisma.stockLedgerEntry.count({ where: { storageBinId } }),
      this.prisma.inventoryDocumentLine.count({ where: { storageBinId, document: { deletedAt: null } } }),
      this.prisma.inventoryDocumentLine.count({ where: { toStorageBinId: storageBinId, document: { deletedAt: null } } }),
    ]);
    return {
      hasStock: qtyRows.length > 0,
      hasLedger: ledger > 0,
      hasDocumentLines: fromLines + toLines > 0,
    };
  }

  async isReferenced(id: string) {
    const u = await this.usage(id);
    return u.hasStock || u.hasLedger || u.hasDocumentLines;
  }

  create(companyId: string, warehouseId: string, dto: CreateStorageBinDto, createdBy?: string) {
    const status = dto.status ?? (dto.isActive === false ? 'INACTIVE' : 'ACTIVE');
    return this.prisma.storageBin.create({
      data: {
        companyId: parseBigIntId(companyId),
        warehouseId: parseBigIntId(warehouseId),
        binCode: dto.binCode.trim().toUpperCase(),
        binName: dto.binName?.trim() || null,
        status,
        isActive: status === 'ACTIVE',
        isSystem: false,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateStorageBinDto, updatedBy?: string) {
    const status =
      dto.status !== undefined
        ? dto.status
        : dto.isActive === undefined
          ? undefined
          : dto.isActive
            ? 'ACTIVE'
            : 'INACTIVE';
    return this.prisma.storageBin.update({
      where: { storageBinId: parseBigIntId(id) },
      data: {
        ...(dto.binCode !== undefined ? { binCode: dto.binCode.trim().toUpperCase() } : {}),
        ...(dto.binName !== undefined ? { binName: dto.binName === null ? null : dto.binName.trim() } : {}),
        ...(status !== undefined ? { status, isActive: status === 'ACTIVE' } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.storageBin.update({
      where: { storageBinId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
        status: 'INACTIVE',
      },
    });
  }
}
