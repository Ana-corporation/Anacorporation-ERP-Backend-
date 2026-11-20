import { Injectable } from '@nestjs/common';
import { NumberSeriesDocumentType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export const NUMBER_SERIES_AUDIT_ENTITIES = ['NumberSeriesConfig', 'NumberSeriesLine'] as const;

type Db = Prisma.TransactionClient;

@Injectable()
export class NumberSeriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  /** Plain client for helpers that take a transaction client (reads outside a transaction). */
  get client(): Db {
    return this.db;
  }

  /** Categories (Item Groups) with a category code: active ones, plus inactive ones in includeIds. */
  findCategories(companyId: bigint, includeIds: bigint[] = [], db: Db = this.db) {
    return db.itemGroup.findMany({
      where: {
        companyId,
        deletedAt: null,
        categoryCode: { not: null },
        OR: [{ isActive: true }, ...(includeIds.length ? [{ itemGroupId: { in: includeIds } }] : [])],
      },
      select: {
        itemGroupId: true,
        name: true,
        categoryCode: true,
        storeCategory: { select: { storeCategoryId: true, name: true, sortOrder: true } },
      },
      orderBy: [{ storeCategory: { sortOrder: 'asc' } }, { categoryCode: 'asc' }],
    });
  }

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Prisma.TransactionClient));
  }

  findConfigs(companyId: bigint) {
    return this.prisma.numberSeriesConfig.findMany({ where: { companyId } });
  }

  findConfig(companyId: bigint, documentType: NumberSeriesDocumentType, db: Db = this.db) {
    return db.numberSeriesConfig.findUnique({
      where: { companyId_documentType: { companyId, documentType } },
      include: { lines: { orderBy: { numberSeriesLineId: 'asc' } } },
    });
  }

  /**
   * Row-locks the series' lines, then the config, in the same order the generator takes them,
   * so a save and a number generation never interleave (no lost lock flag, no deadlock).
   */
  async lockSeries(tx: Prisma.TransactionClient, numberSeriesConfigId: bigint) {
    await tx.$queryRaw`
      SELECT number_series_line_id FROM number_series_lines
      WHERE number_series_config_id = ${numberSeriesConfigId}
      ORDER BY number_series_line_id FOR UPDATE`;
    await tx.$queryRaw`
      SELECT number_series_config_id FROM number_series_configs
      WHERE number_series_config_id = ${numberSeriesConfigId} FOR UPDATE`;
  }

  /** Non-deleted store categories (active ones, plus inactive ones listed in includeIds). */
  findStoreCategories(companyId: bigint, includeIds: bigint[] = [], db: Db = this.db) {
    return db.storeCategory.findMany({
      where: {
        companyId,
        deletedAt: null,
        OR: [{ isActive: true }, ...(includeIds.length ? [{ storeCategoryId: { in: includeIds } }] : [])],
      },
      select: { storeCategoryId: true, name: true, numberSeriesCode: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findStoreCategoriesByIds(companyId: bigint, ids: bigint[], db: Db = this.db) {
    if (ids.length === 0) return Promise.resolve([]);
    return db.storeCategory.findMany({
      where: { companyId, deletedAt: null, storeCategoryId: { in: ids } },
      select: { storeCategoryId: true, name: true, numberSeriesCode: true },
    });
  }

  /** Other live categories of the company already holding one of these codes. */
  findCategoryCodeOwners(companyId: bigint, codes: string[], excludeIds: bigint[], db: Db = this.db) {
    if (codes.length === 0) return Promise.resolve([]);
    return db.storeCategory.findMany({
      where: {
        companyId,
        deletedAt: null,
        numberSeriesCode: { in: codes },
        storeCategoryId: { notIn: excludeIds },
      },
      select: { storeCategoryId: true, name: true, numberSeriesCode: true },
    });
  }

  async findAudit(companyId: bigint, skip: number, take: number) {
    const where: Prisma.UserAuditWhereInput = {
      companyId,
      entityName: { in: [...NUMBER_SERIES_AUDIT_ENTITIES] },
    };
    const [items, total] = await Promise.all([
      this.prisma.userAudit.findMany({
        where,
        orderBy: [{ performedAt: 'desc' }, { auditId: 'desc' }],
        skip,
        take,
      }),
      this.prisma.userAudit.count({ where }),
    ]);
    return { items, total };
  }
}
