import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const groupSelect = {
  itemGroupId: true,
  companyId: true,
  storeCategoryId: true,
  parentId: true,
  name: true,
  categoryCode: true,
  description: true,
  materialStage: true,
  sortOrder: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedBy: true,
  updatedAt: true,
  storeCategory: { select: { storeCategoryId: true, name: true } },
  _count: {
    select: {
      children: { where: { deletedAt: null } },
      items: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.ItemGroupSelect;

export type ItemGroupRow = Prisma.ItemGroupGetPayload<{ select: typeof groupSelect }>;

@Injectable()
export class ItemGroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as unknown as Prisma.TransactionClient));
  }

  private get db(): Prisma.TransactionClient {
    return this.prisma as unknown as Prisma.TransactionClient;
  }

  /** Non-deleted groups of the company (optionally one store), ordered for tree building. */
  list(companyId: bigint, storeCategoryId?: bigint, includeInactive = true, db: Prisma.TransactionClient = this.db) {
    return db.itemGroup.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(storeCategoryId ? { storeCategoryId } : {}),
        ...(includeInactive ? {} : { isActive: true }),
      },
      select: groupSelect,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findById(companyId: bigint, id: bigint, db: Prisma.TransactionClient = this.db) {
    return db.itemGroup.findFirst({
      where: { itemGroupId: id, companyId, deletedAt: null },
      select: groupSelect,
    });
  }

  findStoreCategory(companyId: bigint, storeCategoryId: bigint, db: Prisma.TransactionClient = this.db) {
    return db.storeCategory.findFirst({
      where: { storeCategoryId, companyId, deletedAt: null },
      select: { storeCategoryId: true, isActive: true },
    });
  }

  /** Same name (case-insensitive) under the same parent in the same store. */
  findSiblingClash(
    db: Prisma.TransactionClient,
    companyId: bigint,
    storeCategoryId: bigint,
    parentId: bigint | null,
    name: string,
    excludeId?: bigint,
  ) {
    return db.itemGroup.findFirst({
      where: {
        companyId,
        storeCategoryId,
        parentId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { itemGroupId: excludeId } } : {}),
      },
      select: { itemGroupId: true },
    });
  }

  /** Parent chain of a group, nearest first (stops at the root). */
  async ancestors(db: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    return db.$queryRaw<Array<{ item_group_id: bigint; parent_id: bigint | null }>>`
      WITH RECURSIVE chain AS (
        SELECT item_group_id, parent_id, 0 AS depth FROM item_groups
        WHERE item_group_id = ${id} AND company_id = ${companyId}
        UNION ALL
        SELECT g.item_group_id, g.parent_id, c.depth + 1 FROM item_groups g
        JOIN chain c ON g.item_group_id = c.parent_id
        WHERE c.depth < 50
      )
      SELECT item_group_id, parent_id FROM chain ORDER BY depth`;
  }

  /** Deepest level below the group (0 = no children). */
  async subtreeHeight(db: Prisma.TransactionClient, id: bigint): Promise<number> {
    const [row] = await db.$queryRaw<Array<{ height: number }>>`
      WITH RECURSIVE tree AS (
        SELECT item_group_id, 0 AS depth FROM item_groups WHERE item_group_id = ${id}
        UNION ALL
        SELECT g.item_group_id, t.depth + 1 FROM item_groups g
        JOIN tree t ON g.parent_id = t.item_group_id
        WHERE g.deleted_at IS NULL AND t.depth < 50
      )
      SELECT COALESCE(MAX(depth), 0)::int AS height FROM tree`;
    return row?.height ?? 0;
  }

  /** Another live group of the company already using this category code. */
  findCodeClash(db: Prisma.TransactionClient, companyId: bigint, categoryCode: string, excludeId?: bigint) {
    return db.itemGroup.findFirst({
      where: { companyId, categoryCode, deletedAt: null, ...(excludeId ? { NOT: { itemGroupId: excludeId } } : {}) },
      select: { itemGroupId: true, name: true },
    });
  }

  /**
   * The company's ITEM number series when it numbers by category, plus this category's counter
   * line (row-locked so a parallel part-number generation waits). null when the series is not
   * category-based.
   */
  async categorySeriesLine(tx: Prisma.TransactionClient, companyId: bigint, itemGroupId: bigint) {
    const [config] = await tx.$queryRaw<Array<{ number_series_config_id: bigint; serial_length_default: number }>>`
      SELECT number_series_config_id, serial_length_default FROM number_series_configs
      WHERE company_id = ${companyId} AND document_type::text = 'ITEM' AND segment_source::text = 'ITEM_GROUP'`;
    if (!config) return null;
    const [line] = await tx.$queryRaw<
      Array<{ number_series_line_id: bigint; segment_code: string; last_number: number; is_locked: boolean }>
    >`
      SELECT number_series_line_id, segment_code, last_number, is_locked FROM number_series_lines
      WHERE number_series_config_id = ${config.number_series_config_id} AND segment_ref_id = ${itemGroupId}
      FOR UPDATE`;
    return {
      configId: config.number_series_config_id,
      serialLengthDefault: config.serial_length_default,
      line: line ?? null,
      locked: Boolean(line && (line.is_locked || line.last_number > 0)),
    };
  }

  /** Category ids whose code is locked (a part number was generated with it). */
  async lockedCodeIds(companyId: bigint): Promise<Set<string>> {
    const rows = await this.db.$queryRaw<Array<{ segment_ref_id: bigint }>>`
      SELECT l.segment_ref_id FROM number_series_lines l
      JOIN number_series_configs c ON c.number_series_config_id = l.number_series_config_id
      WHERE c.company_id = ${companyId} AND c.document_type::text = 'ITEM' AND c.segment_source::text = 'ITEM_GROUP'
        AND l.segment_ref_id IS NOT NULL AND (l.is_locked OR l.last_number > 0)`;
    return new Set(rows.map((r) => r.segment_ref_id.toString()));
  }

  async lock(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    await tx.$queryRaw`
      SELECT item_group_id FROM item_groups
      WHERE item_group_id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
      FOR UPDATE`;
  }
}
