import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { parseBigIntId, serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { CreateItemGroupDto, ItemGroupListQueryDto, UpdateItemGroupDto } from './dto/item-group.dto';
import { CATEGORY_CODE_PATTERN, ITEM_GROUP_ERROR_CODES, ITEM_GROUP_MAX_DEPTH } from './item-groups.constants';
import { ItemGroupRow, ItemGroupsRepository } from './item-groups.repository';

type GroupView = ReturnType<ItemGroupsService['toRow']> & {
  depth: number;
  path: string;
  /** Own code, or the nearest parent's (used for the part number) */
  effectiveCategoryCode: string | null;
  /** Code fixed: part numbers were generated with it */
  codeLocked: boolean;
};
type GroupNode = GroupView & { children: GroupNode[] };

const notFound = () =>
  new BusinessException('Item group not found', HttpStatus.NOT_FOUND, undefined, ITEM_GROUP_ERROR_CODES.NOT_FOUND);

const badParent = (message: string) =>
  new BusinessException(message, HttpStatus.BAD_REQUEST, [{ field: 'parentId', message }], ITEM_GROUP_ERROR_CODES.PARENT_INVALID);

const tooDeep = () =>
  new BusinessException(
    `Item groups can be at most ${ITEM_GROUP_MAX_DEPTH + 1} levels deep`,
    HttpStatus.BAD_REQUEST,
    [{ field: 'parentId', message: 'Too many levels' }],
    ITEM_GROUP_ERROR_CODES.TOO_DEEP,
  );

const nameExists = () =>
  new BusinessException(
    'A group with this name already exists at this level',
    HttpStatus.CONFLICT,
    [{ field: 'name', message: 'Name already used' }],
    ITEM_GROUP_ERROR_CODES.NAME_EXISTS,
  );

/** Uppercased category code, null when blank; rejects anything but 2-4 letters. */
const normalizeCode = (raw: string | null | undefined): string | null => {
  const code = (raw ?? '').trim().toUpperCase();
  if (!code) return null;
  if (!CATEGORY_CODE_PATTERN.test(code)) {
    throw new BusinessException(
      'Category code must be 2 to 4 letters A-Z',
      HttpStatus.BAD_REQUEST,
      [{ field: 'categoryCode', message: 'Use 2 to 4 letters A-Z' }],
      ITEM_GROUP_ERROR_CODES.CODE_INVALID,
    );
  }
  return code;
};

const codeExists = () =>
  new BusinessException(
    'Another category already uses this category code',
    HttpStatus.CONFLICT,
    [{ field: 'categoryCode', message: 'Code already used' }],
    ITEM_GROUP_ERROR_CODES.CODE_EXISTS,
  );

const stageTaken = (message = 'Another category already has this stage') =>
  new BusinessException(message, HttpStatus.CONFLICT, [{ field: 'materialStage', message }], ITEM_GROUP_ERROR_CODES.STAGE_TAKEN);

const isUniqueViolation = (error: unknown) =>
  (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
  (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('23505'));

@Injectable()
export class ItemGroupsService {
  constructor(
    private readonly repository: ItemGroupsRepository,
    private readonly auditService: AuditService,
  ) {}

  /** Flat list in tree order (parent before children), with depth and "A / B / C" path. */
  async findAll(companyId: string, query: ItemGroupListQueryDto) {
    const rows = await this.loadFlat(companyId, query);
    const items = await this.auditService.withAuditList(rows);
    return toPaginatedResult(items, items.length, 1, Math.max(items.length, 1));
  }

  /** Nested tree for the group picker. */
  async tree(companyId: string, query: ItemGroupListQueryDto) {
    const rows = await this.loadFlat(companyId, query);
    const byId = new Map<string, GroupNode>(rows.map((r) => [String(r.itemGroupId), { ...r, children: [] }]));
    const roots: GroupNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(String(node.parentId)) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async findOne(id: string, companyId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const row = await this.repository.findById(company, parseBigIntId(id));
    if (!row) throw notFound();
    const [rows, locked] = await Promise.all([
      this.repository.list(company, row.storeCategoryId),
      this.repository.lockedCodeIds(company),
    ]);
    const view =
      this.flatten(rows, locked).find((r) => String(r.itemGroupId) === String(row.itemGroupId)) ??
      { ...this.toRow(row), depth: 0, path: row.name, effectiveCategoryCode: row.categoryCode, codeLocked: locked.has(row.itemGroupId.toString()) };
    return this.auditService.withAudit(view);
  }

  async create(companyId: string, dto: CreateItemGroupDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const parentId = dto.parentId ? BigInt(dto.parentId) : null;

    const created = await this.guardUnique(async () =>
      this.repository.transaction(async (tx) => {
        let storeCategoryId: bigint;
        if (parentId) {
          const parent = await this.repository.findById(company, parentId, tx);
          if (!parent) throw badParent('Parent group not found');
          if (dto.storeCategoryId && BigInt(dto.storeCategoryId) !== parent.storeCategoryId) {
            throw badParent('A sub-group must be in the same store as its parent');
          }
          storeCategoryId = parent.storeCategoryId;
          const parentDepth = (await this.repository.ancestors(tx, company, parentId)).length - 1;
          if (parentDepth + 1 > ITEM_GROUP_MAX_DEPTH) throw tooDeep();
        } else {
          storeCategoryId = BigInt(dto.storeCategoryId!);
          const store = await this.repository.findStoreCategory(company, storeCategoryId, tx);
          if (!store) {
            throw new BusinessException(
              'Store not found',
              HttpStatus.BAD_REQUEST,
              [{ field: 'storeCategoryId', message: 'Store not found' }],
              ITEM_GROUP_ERROR_CODES.STORE_INVALID,
            );
          }
        }
        if (await this.repository.findSiblingClash(tx, company, storeCategoryId, parentId, dto.name)) throw nameExists();
        const categoryCode = normalizeCode(dto.categoryCode);
        if (categoryCode && (await this.repository.findCodeClash(tx, company, categoryCode))) throw codeExists();
        const group = await tx.itemGroup.create({
          data: {
            companyId: company,
            storeCategoryId,
            parentId,
            name: dto.name,
            categoryCode,
            description: dto.description ?? null,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
            materialStage: await this.checkedStage(tx, company, dto.materialStage ?? null, null),
            createdBy: BigInt(actorId),
          },
        });
        if (categoryCode) await this.syncSeriesLine(tx, company, group.itemGroupId, categoryCode, BigInt(actorId));
        return group;
      }),
    );

    await this.audit(companyId, actorId, UserAuditAction.create, created.itemGroupId, {
      name: created.name,
      categoryCode: created.categoryCode,
      storeCategoryId: created.storeCategoryId.toString(),
      parentId: created.parentId?.toString() ?? null,
    });
    return this.findOne(created.itemGroupId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdateItemGroupDto, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const groupId = parseBigIntId(id);

    await this.guardUnique(async () =>
      this.repository.transaction(async (tx) => {
        await this.repository.lock(tx, company, groupId);
        const existing = await this.repository.findById(company, groupId, tx);
        if (!existing) throw notFound();

        const parentId = dto.parentId === undefined ? existing.parentId : dto.parentId ? BigInt(dto.parentId) : null;
        if (parentId !== existing.parentId && parentId !== null) {
          const parent = await this.repository.findById(company, parentId, tx);
          if (!parent) throw badParent('Parent group not found');
          if (parent.storeCategoryId !== existing.storeCategoryId) {
            throw badParent('A sub-group must be in the same store as its parent');
          }
          const chain = await this.repository.ancestors(tx, company, parentId);
          if (chain.some((g) => g.item_group_id === groupId)) {
            throw badParent('A group cannot be moved under itself or one of its sub-groups');
          }
          const height = await this.repository.subtreeHeight(tx, groupId);
          if (chain.length + height > ITEM_GROUP_MAX_DEPTH) throw tooDeep();
        }

        const name = dto.name ?? existing.name;
        if (
          (dto.name !== undefined || parentId !== existing.parentId) &&
          (await this.repository.findSiblingClash(tx, company, existing.storeCategoryId, parentId, name, groupId))
        ) {
          throw nameExists();
        }

        const nextCode = dto.categoryCode === undefined ? existing.categoryCode : normalizeCode(dto.categoryCode);
        const codeChanged = nextCode !== existing.categoryCode;
        const series = codeChanged ? await this.repository.categorySeriesLine(tx, company, groupId) : null;
        if (codeChanged) {
          if (series?.locked) {
            throw new BusinessException(
              'The category code cannot change after part numbers were generated with it.',
              HttpStatus.BAD_REQUEST,
              [{ field: 'categoryCode', message: 'Locked: part numbers already use this code' }],
              ITEM_GROUP_ERROR_CODES.CODE_LOCKED,
            );
          }
          if (nextCode && (await this.repository.findCodeClash(tx, company, nextCode, groupId))) throw codeExists();
        }

        const updated = await tx.itemGroup.update({
          where: { itemGroupId: groupId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.parentId !== undefined ? { parentId } : {}),
            ...(codeChanged ? { categoryCode: nextCode } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.materialStage !== undefined
              ? { materialStage: await this.checkedStage(tx, company, dto.materialStage ?? null, groupId) }
              : {}),
            updatedBy: BigInt(actorId),
            updatedAt: new Date(),
          },
        });
        if (codeChanged) await this.syncSeriesLine(tx, company, groupId, nextCode, BigInt(actorId), series);
        return updated;
      }),
    );

    await this.audit(companyId, actorId, UserAuditAction.update, groupId, dto as Record<string, unknown>);
    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const company = parseBigIntId(companyId, 'companyId');
    const groupId = parseBigIntId(id);
    await this.repository.transaction(async (tx) => {
      await this.repository.lock(tx, company, groupId);
      const existing = await this.repository.findById(company, groupId, tx);
      if (!existing) throw notFound();
      if (existing._count.children > 0 || existing._count.items > 0) {
        throw new BusinessException(
          'This group has sub-groups or items; move them or deactivate the group instead',
          HttpStatus.CONFLICT,
          undefined,
          ITEM_GROUP_ERROR_CODES.IN_USE,
        );
      }
      await tx.itemGroup.update({
        where: { itemGroupId: groupId },
        data: { deletedAt: new Date(), deletedBy: BigInt(actorId), isActive: false },
      });
      if (existing.categoryCode) await this.syncSeriesLine(tx, company, groupId, null, BigInt(actorId));
    });
    await this.audit(companyId, actorId, UserAuditAction.delete, groupId);
    return { message: 'Item group deleted' };
  }

  /**
   * Keeps the category's Number Series line in step with its code when the series numbers by
   * category: new code → line created; changed code → line code updated (only while unused);
   * code removed / category deleted → unused line removed. No-op for other series.
   */
  private async syncSeriesLine(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    itemGroupId: bigint,
    code: string | null,
    actor: bigint,
    known?: Awaited<ReturnType<ItemGroupsRepository['categorySeriesLine']>>,
  ) {
    const series = known ?? (await this.repository.categorySeriesLine(tx, companyId, itemGroupId));
    if (!series) return;
    if (code) {
      if (!series.line) {
        await tx.numberSeriesLine.create({
          data: {
            numberSeriesConfigId: series.configId,
            companyId,
            segmentRefId: itemGroupId,
            segmentCode: code,
            serialLength: series.serialLengthDefault,
            createdBy: actor,
          },
        });
      } else if (series.line.segment_code !== code) {
        await tx.numberSeriesLine.update({
          where: { numberSeriesLineId: series.line.number_series_line_id },
          data: { segmentCode: code, updatedBy: actor, updatedAt: new Date() },
        });
      }
    } else if (series.line && !series.locked) {
      await tx.numberSeriesLine.delete({ where: { numberSeriesLineId: series.line.number_series_line_id } });
    }
  }

  private async loadFlat(companyId: string, query: ItemGroupListQueryDto) {
    const company = parseBigIntId(companyId, 'companyId');
    const [rows, locked] = await Promise.all([
      this.repository.list(company, query.storeCategoryId ? BigInt(query.storeCategoryId) : undefined, query.includeInactive),
      this.repository.lockedCodeIds(company),
    ]);
    return this.flatten(rows, locked);
  }

  /**
   * Depth-first order with depth, path and the effective category code (own, or the nearest
   * parent's). Rows whose parent is filtered out become roots.
   */
  private flatten(rows: ItemGroupRow[], lockedCodes: Set<string> = new Set()): GroupView[] {
    const ids = new Set(rows.map((r) => r.itemGroupId));
    const children = new Map<string, ItemGroupRow[]>();
    const roots: ItemGroupRow[] = [];
    for (const row of rows) {
      if (row.parentId && ids.has(row.parentId)) {
        const key = row.parentId.toString();
        children.set(key, [...(children.get(key) ?? []), row]);
      } else {
        roots.push(row);
      }
    }
    const out: GroupView[] = [];
    const walk = (row: ItemGroupRow, depth: number, path: string[], inheritedCode: string | null) => {
      const nextPath = [...path, row.name];
      const effectiveCategoryCode = row.categoryCode ?? inheritedCode;
      out.push({
        ...this.toRow(row),
        depth,
        path: nextPath.join(' / '),
        effectiveCategoryCode,
        codeLocked: lockedCodes.has(row.itemGroupId.toString()),
      });
      for (const child of children.get(row.itemGroupId.toString()) ?? []) walk(child, depth + 1, nextPath, effectiveCategoryCode);
    };
    for (const root of roots) walk(root, 0, [], null);
    return out;
  }

  private toRow(row: ItemGroupRow) {
    return serialize({
      itemGroupId: row.itemGroupId,
      companyId: row.companyId,
      storeCategoryId: row.storeCategoryId,
      storeCategoryName: row.storeCategory.name,
      parentId: row.parentId,
      name: row.name,
      categoryCode: row.categoryCode,
      description: row.description,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      materialStage: row.materialStage,
      childCount: row._count.children,
      itemCount: row._count.items,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    }) as unknown as Record<string, unknown> & { itemGroupId: string; parentId: string | null; name: string };
  }

  /** A race that slips past the checks hits a partial unique index → the matching 409. */
  private async guardUnique<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) {
        const message = String((error as Error).message);
        if (/material_stage|stage_uidx/.test(message)) throw stageTaken();
        throw /category_code|segment_code/.test(message) ? codeExists() : nameExists();
      }
      throw error;
    }
  }

  /**
   * Many SF-stage (process) categories per company are allowed — PLT, MCN, FAB, SPR, …
   * Only FF stays unique (optional; mechanical parts use RM + process = two part numbers).
   */
  private async checkedStage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    stage: string | null,
    selfId: bigint | null,
  ): Promise<string | null> {
    if (stage !== 'FF') return stage;
    const other = await tx.itemGroup.findFirst({
      where: { companyId, materialStage: 'FF', deletedAt: null, ...(selfId ? { NOT: { itemGroupId: selfId } } : {}) },
      select: { name: true },
    });
    if (other) throw stageTaken(`${other.name} is already the FF category`);
    return stage;
  }

  private audit(companyId: string, actorId: string, action: UserAuditAction, id: bigint, newValue?: Record<string, unknown>) {
    return this.auditService.log({
      companyId,
      performedBy: actorId,
      action,
      entityName: 'ItemGroup',
      entityId: id.toString(),
      newValue,
    });
  }
}
