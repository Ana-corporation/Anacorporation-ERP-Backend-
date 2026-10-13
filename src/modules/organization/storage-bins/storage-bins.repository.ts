import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateStorageBinDto, UpdateStorageBinDto } from './dto/storage-bin.dto';

const STORAGE_BINS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'binCode', name: 'binName' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['binCode', 'binName'],
  sortFields: ['binCode', 'binName', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class StorageBinsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const locationId = query.inventoryLocationId || query.warehouseId;
    const base: Prisma.StorageBinWhereInput = {
      companyId: parseBigIntId(companyId),
      deletedAt: null,
      ...(locationId ? { warehouseId: parseBigIntId(locationId) } : {}),
    };
    const where = buildListWhere(base, query, STORAGE_BINS_LIST_FILTER) as Prisma.StorageBinWhereInput;

    return this.prisma.$transaction([
      this.prisma.storageBin.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, STORAGE_BINS_LIST_FILTER),
      }),
      this.prisma.storageBin.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
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
      data: bins.map((bin) => ({
        companyId,
        warehouseId,
        binCode: bin.binCode,
        binName: bin.binName?.trim() || null,
        isActive: bin.isActive ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      })),
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

  async isReferenced(id: string) {
    const storageBinId = parseBigIntId(id);
    const [balances, ledger, lines] = await Promise.all([
      this.prisma.stockBalance.count({ where: { storageBinId } }),
      this.prisma.stockLedgerEntry.count({ where: { storageBinId } }),
      this.prisma.inventoryDocumentLine.count({ where: { storageBinId, document: { deletedAt: null } } }),
    ]);
    return balances + ledger + lines > 0;
  }

  create(companyId: string, warehouseId: string, dto: CreateStorageBinDto, createdBy?: string) {
    return this.prisma.storageBin.create({
      data: {
        companyId: parseBigIntId(companyId),
        warehouseId: parseBigIntId(warehouseId),
        binCode: dto.binCode.trim().toUpperCase(),
        binName: dto.binName?.trim() || null,
        isActive: dto.isActive ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateStorageBinDto, updatedBy?: string) {
    return this.prisma.storageBin.update({
      where: { storageBinId: parseBigIntId(id) },
      data: {
        ...(dto.binCode !== undefined ? { binCode: dto.binCode.trim().toUpperCase() } : {}),
        ...(dto.binName !== undefined ? { binName: dto.binName === null ? null : dto.binName.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
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
      },
    });
  }
}
