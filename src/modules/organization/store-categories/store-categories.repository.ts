import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const withLocationCount = {
  _count: { select: { warehouses: { where: { deletedAt: null } } } },
} satisfies Prisma.StoreCategoryInclude;

export type StoreCategoryRow = Prisma.StoreCategoryGetPayload<{ include: typeof withLocationCount }>;

@Injectable()
export class StoreCategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: bigint) {
    return this.prisma.storeCategory.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: withLocationCount,
    });
  }

  findById(db: Prisma.TransactionClient | PrismaService, companyId: bigint, id: bigint) {
    return (db as Prisma.TransactionClient).storeCategory.findFirst({
      where: { storeCategoryId: id, companyId, deletedAt: null },
      include: withLocationCount,
    });
  }

  /** Row lock so prefix changes / deletes and new locations using the category are serialized. */
  async lock(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    await tx.$queryRaw`
      SELECT store_category_id FROM store_categories
      WHERE store_category_id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
      FOR UPDATE`;
  }

  findClash(
    db: Prisma.TransactionClient,
    companyId: bigint,
    field: 'name' | 'codePrefix',
    value: string,
    excludeId?: bigint,
  ) {
    return db.storeCategory.findFirst({
      where: {
        companyId,
        deletedAt: null,
        ...(field === 'name'
          ? { name: { equals: value, mode: 'insensitive' } }
          : { codePrefix: value }),
        ...(excludeId ? { NOT: { storeCategoryId: excludeId } } : {}),
      },
      select: { storeCategoryId: true },
    });
  }

  countLocations(db: Prisma.TransactionClient, id: bigint) {
    return db.warehouse.count({ where: { storeCategoryId: id, deletedAt: null } });
  }
}
