import { Injectable } from '@nestjs/common';
import { Bom, BomStatus, Prisma } from '@prisma/client';
import { getPaginationParams } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { loadProcurementTypes } from '@/modules/inventory/item-master/item-procurement.util';
import { DocumentNumberService } from '@/modules/shared/number-series/document-number.service';
import { IdempotencyService } from '@/modules/shared/idempotency/idempotency.service';
import {
  BOM_ERROR_CODES,
  BomIssue,
  bomError,
  bomNotFound,
  bomValidationError,
  rowVersionConflict,
} from './bom.constants';
import { buildGroups } from './bom-groups';
import { actorOf, assertDraft, assertNoForbiddenKeys, BomLinesService } from './bom-lines.service';
import { computeRequirements, RequirementLineInput } from './bom-requirements';
import { checkEffectiveDates, checkParent, checkQuantity, toDecimal, validateBom } from './bom-validation';
import { BomViewService, computeAllowedActions } from './bom-view.service';
import { BomsRepository, Db } from './boms.repository';
import {
  BomListQueryDto,
  ByItemQueryDto,
  CreateBomDto,
  ReasonDto,
  ReleaseBomDto,
  RequirementsDto,
  ReviseBomDto,
  UpdateBomDto,
  WhereUsedQueryDto,
} from './dto/bom.dto';

const LIST_ORDER: ListFilterOptions = {
  sortFields: ['bomNumber', 'version', 'status', 'createdAt', 'updatedAt'],
  defaultSortField: 'updatedAt',
  tieBreaker: 'bomId',
};

const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : v === null ? null : undefined);

@Injectable()
export class BomsService {
  constructor(
    private readonly repository: BomsRepository,
    private readonly lines: BomLinesService,
    private readonly view: BomViewService,
    private readonly documentNumbers: DocumentNumberService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------- read

  get(companyId: bigint, bomId: bigint | null, user: AuthenticatedUser) {
    if (!bomId) throw bomNotFound();
    return this.view.detail(companyId, bomId, user);
  }

  /** Latest version of each BOM by default (allVersions=true for every version). */
  async list(companyId: bigint, query: BomListQueryDto, user: AuthenticatedUser) {
    const db = this.repository.db;
    const { skip, limit, page } = getPaginationParams(query);
    const search = query.search?.trim();
    let latestIds: bigint[] | null = null;
    if (!query.allVersions) {
      const rows = await db.$queryRaw<Array<{ bom_id: bigint }>>`
        SELECT DISTINCT ON (root_bom_id) bom_id FROM boms
        WHERE company_id = ${companyId} AND deleted_at IS NULL
        ORDER BY root_bom_id, version DESC`;
      latestIds = rows.map((r) => r.bom_id);
    }
    const where: Prisma.BomWhereInput = {
      companyId,
      deletedAt: null,
      ...(latestIds ? { bomId: { in: latestIds } } : {}),
      ...(query.status ? { status: query.status.toUpperCase() as BomStatus } : {}),
      ...(query.bomType ? { bomType: query.bomType } : {}),
      ...(query.parentItemId ? { parentItemId: BigInt(query.parentItemId) } : {}),
      ...(search
        ? {
            OR: [
              { bomNumber: { contains: search, mode: 'insensitive' } },
              { parentItem: { itemCode: { contains: search, mode: 'insensitive' } } },
              { parentItem: { description: { contains: search, mode: 'insensitive' } } },
              { parentItem: { oldCode: { contains: search, mode: 'insensitive' } } },
              { parentItem: { machine: { is: { machineCode: { contains: search, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.bom.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, LIST_ORDER) as Prisma.BomOrderByWithRelationInput,
        include: {
          parentItem: { select: { itemId: true, itemCode: true, oldCode: true, description: true } },
          uom: { select: { uomId: true, code: true } },
          _count: { select: { lines: true } },
        },
      }),
      db.bom.count({ where }),
    ]);
    const roots = [...new Set(items.map((b) => b.rootBomId).filter((r): r is bigint => r !== null))];
    const [drafts, current] = await Promise.all([
      db.bom.findMany({ where: { companyId, rootBomId: { in: roots }, status: BomStatus.DRAFT, deletedAt: null }, select: { rootBomId: true, version: true } }),
      db.bom.findMany({ where: { companyId, rootBomId: { in: roots }, isCurrentVersion: true, deletedAt: null }, select: { rootBomId: true, version: true } }),
    ]);
    const draftByRoot = new Map(drafts.map((d) => [d.rootBomId!.toString(), d.version]));
    const currentByRoot = new Map(current.map((d) => [d.rootBomId!.toString(), d.version]));
    const machines = await db.machine.findMany({
      where: { companyId, deletedAt: null, itemId: { in: [...new Set(items.map((b) => b.parentItemId))] } },
      select: { itemId: true, machineId: true, machineCode: true, machineType: true, salesOrderNo: true, baseMachine: { select: { machineCode: true } } },
    });
    const machineByItem = new Map(machines.map((m) => [m.itemId.toString(), m]));
    const rows = items.map(({ _count, parentItem, ...b }) => {
      const root = b.rootBomId?.toString() ?? '';
      return {
        ...b,
        baseQuantity: b.baseQuantity.toFixed(6),
        parentItem: { itemId: parentItem.itemId, itemCode: parentItem.itemCode, oldCode: parentItem.oldCode, name: parentItem.description },
        lineCount: _count.lines,
        machine: (() => {
          const m = machineByItem.get(b.parentItemId.toString());
          return m
            ? { machineId: m.machineId, machineCode: m.machineCode, machineType: m.machineType, salesOrderNo: m.salesOrderNo, baseMachineCode: m.baseMachine?.machineCode ?? null }
            : null;
        })(),
        currentReleasedVersion: currentByRoot.get(root) ?? null,
        openDraftVersion: draftByRoot.get(root) ?? null,
        allowedActions: computeAllowedActions(b, user, { hasOpenDraft: draftByRoot.has(root) }),
      };
    });
    const withAudit = await this.auditService.withAuditList(serialize(rows) as unknown as Record<string, unknown>[]);
    return toPaginatedResult(withAudit, total, page, limit);
  }

  async revisions(companyId: bigint, bomId: bigint | null) {
    const bom = bomId ? await this.repository.findBom(this.repository.db, companyId, bomId) : null;
    if (!bom) throw bomNotFound();
    const versions = await this.repository.db.bom.findMany({
      where: { companyId, rootBomId: bom.rootBomId, deletedAt: null },
      orderBy: { version: 'desc' },
      select: {
        bomId: true,
        bomNumber: true,
        version: true,
        revisionLabel: true,
        revisionReason: true,
        status: true,
        isCurrentVersion: true,
        effectiveFrom: true,
        effectiveTo: true,
        releasedAt: true,
        releasedBy: true,
        obsoletedAt: true,
        obsoleteReason: true,
        cancelledAt: true,
        cancelReason: true,
        createdAt: true,
        createdBy: true,
        rowVersion: true,
      },
    });
    const history = await this.repository.db.bomStatusHistory.findMany({
      where: { companyId, bomId: { in: versions.map((v) => v.bomId) } },
      orderBy: { createdAt: 'asc' },
    });
    const names = await this.auditService.loadActorNames([
      ...versions.map((v) => v.releasedBy?.toString() ?? ''),
      ...history.map((h) => h.actorId?.toString() ?? ''),
    ]);
    const nameOf = (id: bigint | null) => (id ? names.get(id.toString()) ?? null : null);
    const items = await this.auditService.withAuditList(
      serialize(versions.map((v) => ({ ...v, releasedByName: nameOf(v.releasedBy) }))) as unknown as Record<string, unknown>[],
    );
    return serialize({
      items,
      statusHistory: history.map((h) => ({
        historyId: h.bomStatusHistoryId,
        bomId: h.bomId,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
        actorId: h.actorId,
        createdBy: h.actorId,
        createdByName: nameOf(h.actorId),
        createdAt: h.createdAt,
      })),
    });
  }

  // ---------------------------------------------------------------- draft

  async create(companyId: bigint, dto: CreateBomDto, user: AuthenticatedUser) {
    assertNoForbiddenKeys(dto, '');
    const actorId = actorOf(user);
    const bomId = await this.repository.transaction(async (tx) => {
      let parentId = dto.parentItemId ? BigInt(dto.parentItemId) : null;
      if (dto.machineId) {
        const machine = await tx.machine.findFirst({ where: { machineId: BigInt(dto.machineId), companyId, deletedAt: null } });
        if (!machine) throw bomError(BOM_ERROR_CODES.PARENT_ITEM_REQUIRED, 'Machine not found', 'machineId');
        parentId = machine.itemId;
      }
      if (parentId) {
        const variant = await tx.machine.findFirst({ where: { itemId: parentId, companyId, machineType: 'ORDER', deletedAt: null } });
        if (variant) {
          throw bomError(
            BOM_ERROR_CODES.MACHINE_VARIANT_BOM_VIA_VARIANT,
            `${variant.machineCode} is a customised machine; its BOM is created from the base machine (Create customised machine).`,
            dto.machineId ? 'machineId' : 'parentItemId',
          );
        }
      }
      const items = await this.repository.loadItems(tx, companyId, parentId ? [parentId] : []);
      const parent = parentId ? items.get(parentId.toString()) : undefined;
      const procurement = await loadProcurementTypes(tx, companyId, parentId ? [parentId] : []);
      const baseQuantity = dto.baseQuantity === undefined ? new Prisma.Decimal(1) : toDecimal(dto.baseQuantity);
      const effectiveFrom = toDate(dto.effectiveFrom) ?? null;
      const effectiveTo = toDate(dto.effectiveTo) ?? null;
      const issues: BomIssue[] = [
        ...checkParent(parent, procurement),
        ...checkQuantity(baseQuantity, 'baseQuantity', 'Base quantity'),
        ...checkEffectiveDates(effectiveFrom, effectiveTo),
      ];
      if (issues.length) throw bomValidationError(issues);
      await this.assertNoReleasedBom(tx, companyId, parentId!, dto.bomType);

      const bomNumber = await this.documentNumbers.reserve(tx, companyId, 'BOM');
      const created = await tx.bom.create({
        data: {
          companyId,
          bomNumber,
          parentItemId: parentId!,
          bomType: dto.bomType,
          bomScope: 'STANDARD',
          baseQuantity: baseQuantity!,
          uomId: BigInt(parent!.inventoryUomId!),
          effectiveFrom,
          effectiveTo,
          revisionLabel: dto.revisionLabel ?? null,
          remarks: dto.remarks ?? null,
          status: BomStatus.DRAFT,
          sourceType: 'MANUAL',
          createdBy: actorId,
        },
      });
      const bom = await tx.bom.update({ where: { bomId: created.bomId }, data: { rootBomId: created.bomId } });
      await this.lines.insertGroups(tx, bom, dto.groups ?? [], actorId);
      await this.repository.writeHistory(tx, { companyId, bomId: bom.bomId, from: null, to: BomStatus.DRAFT, actorId, reason: 'Created' });
      await this.repository.writeAudit(tx, {
        companyId,
        actorId,
        action: 'create',
        entityName: 'Bom',
        entityId: bom.bomId,
        newValue: { bomNumber, parentItemId: parentId, bomType: dto.bomType, groups: dto.groups?.length ?? 0 },
      });
      return bom.bomId;
    });
    return this.view.detail(companyId, bomId, user);
  }

  async updateHeader(companyId: bigint, bomId: bigint | null, dto: UpdateBomDto, user: AuthenticatedUser) {
    if (!bomId) throw bomNotFound();
    assertNoForbiddenKeys(dto, '');
    const actorId = actorOf(user);
    await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      assertDraft(bom);
      if (dto.rowVersion !== bom.rowVersion) throw rowVersionConflict();

      const issues: BomIssue[] = [];
      const data: Prisma.BomUpdateInput = {};
      const parentChange = dto.parentItemId && dto.parentItemId !== bom.parentItemId.toString();
      const typeChange = dto.bomType && dto.bomType !== bom.bomType;
      if ((parentChange || typeChange) && bom.version > 1) {
        issues.push({ field: parentChange ? 'parentItemId' : 'bomType', code: BOM_ERROR_CODES.FIELD_NOT_ALLOWED, message: 'A revision keeps the parent item and BOM type' });
      }
      const parentId = parentChange ? BigInt(dto.parentItemId!) : bom.parentItemId;
      if (parentChange) {
        const items = await this.repository.loadItems(tx, companyId, [parentId]);
        const procurement = await loadProcurementTypes(tx, companyId, [parentId]);
        const parent = items.get(parentId.toString());
        const found = checkParent(parent, procurement);
        issues.push(...found);
        if (!found.length && parent) {
          const used = await tx.bomLine.findFirst({ where: { bomId, componentItemId: parentId } });
          if (used) issues.push({ field: 'parentItemId', code: BOM_ERROR_CODES.SELF_REFERENCE, message: 'This item is already used as a line in the BOM' });
          data.parentItem = { connect: { itemId: parentId } };
          data.uom = { connect: { uomId: BigInt(parent.inventoryUomId!) } };
        }
      }
      if (dto.baseQuantity !== undefined) {
        const base = toDecimal(dto.baseQuantity);
        issues.push(...checkQuantity(base, 'baseQuantity', 'Base quantity'));
        if (base) data.baseQuantity = base;
      }
      const from = dto.effectiveFrom !== undefined ? toDate(dto.effectiveFrom) ?? null : bom.effectiveFrom;
      const to = dto.effectiveTo !== undefined ? toDate(dto.effectiveTo) ?? null : bom.effectiveTo;
      issues.push(...checkEffectiveDates(from, to));
      if (dto.revisionReason !== undefined && bom.version > 1 && !dto.revisionReason?.trim()) {
        issues.push({ field: 'revisionReason', code: BOM_ERROR_CODES.REVISION_REASON_REQUIRED, message: 'Revision reason is required' });
      }
      if (issues.length) throw bomValidationError(issues);
      if (parentChange || typeChange) await this.assertNoReleasedBom(tx, companyId, parentId, dto.bomType ?? bom.bomType);

      if (typeChange) data.bomType = dto.bomType;
      if (dto.effectiveFrom !== undefined) data.effectiveFrom = from;
      if (dto.effectiveTo !== undefined) data.effectiveTo = to;
      if (dto.revisionLabel !== undefined) data.revisionLabel = dto.revisionLabel ?? null;
      if (dto.revisionReason !== undefined) data.revisionReason = dto.revisionReason ?? null;
      if (dto.remarks !== undefined) data.remarks = dto.remarks ?? null;

      if (data.parentItem || data.uom) {
        await tx.bom.update({ where: { bomId }, data: { parentItem: data.parentItem, uom: data.uom } });
        delete data.parentItem;
        delete data.uom;
      }
      await this.repository.touch(tx, bom, actorId, dto.rowVersion, data);
      await this.repository.writeAudit(tx, {
        companyId,
        actorId,
        action: 'update',
        entityName: 'Bom',
        entityId: bomId,
        oldValue: pickHeader(bom),
        newValue: pickHeader(await tx.bom.findUniqueOrThrow({ where: { bomId } })),
      });
    });
    return this.view.detail(companyId, bomId, user);
  }

  /** DRAFT only; soft delete. A released version is never deleted. */
  async remove(companyId: bigint, bomId: bigint | null, user: AuthenticatedUser) {
    if (!bomId) throw bomNotFound();
    const actorId = actorOf(user);
    await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      if (bom.status !== BomStatus.DRAFT) {
        throw bomError(BOM_ERROR_CODES.INVALID_STATUS_TRANSITION, `Only a DRAFT BOM can be deleted (this one is ${bom.status})`);
      }
      await tx.bom.update({ where: { bomId }, data: { deletedAt: new Date(), deletedBy: actorId, rowVersion: { increment: 1 } } });
      await this.repository.writeAudit(tx, { companyId, actorId, action: 'delete', entityName: 'Bom', entityId: bomId, oldValue: pickHeader(bom) });
    });
    return { message: 'BOM draft deleted', bomId: bomId.toString() };
  }

  async validate(companyId: bigint, bomId: bigint | null) {
    if (!bomId) throw bomNotFound();
    const bom = await this.repository.findBom(this.repository.db, companyId, bomId);
    if (!bom) throw bomNotFound();
    return this.runValidation(this.repository.db, bom, bom.status === BomStatus.DRAFT ? 'draft' : 'release');
  }

  // ---------------------------------------------------------------- lifecycle

  async cancel(companyId: bigint, bomId: bigint | null, dto: ReasonDto, user: AuthenticatedUser, idempotencyKey?: string) {
    if (!bomId) throw bomNotFound();
    const reason = this.requireReason(dto.reason);
    const actorId = actorOf(user);
    await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      if (bom.status !== BomStatus.DRAFT) {
        throw bomError(BOM_ERROR_CODES.INVALID_STATUS_TRANSITION, `Only a DRAFT BOM can be cancelled (this one is ${bom.status})`);
      }
      await this.repository.touch(tx, bom, actorId, dto.rowVersion, { status: BomStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason });
      await this.repository.writeHistory(tx, { companyId, bomId, from: bom.status, to: BomStatus.CANCELLED, actorId, reason, idempotencyKey });
      await this.repository.writeAudit(tx, { companyId, actorId, action: 'update', entityName: 'Bom', entityId: bomId, oldValue: { status: bom.status }, newValue: { status: BomStatus.CANCELLED, reason } });
    });
    return this.view.detail(companyId, bomId, user);
  }

  /**
   * One transaction: validate, snapshots, previous current version -> OBSOLETE, this -> RELEASED,
   * status history, audit. Any failure (including the audit write) rolls everything back.
   */
  async release(companyId: bigint, bomId: bigint | null, dto: ReleaseBomDto, user: AuthenticatedUser, idempotencyKey?: string) {
    if (!bomId) throw bomNotFound();
    const actorId = actorOf(user);
    const result = await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      const { result } = await this.idempotency.run(
        tx,
        { companyId, userId: actorId, endpoint: 'POST boms/:bomId/release', key: idempotencyKey, body: { bomId: bomId.toString(), ...dto } },
        async () => {
          if (bom.status !== BomStatus.DRAFT) {
            throw bomError(BOM_ERROR_CODES.INVALID_STATUS_TRANSITION, `Only a DRAFT BOM can be released (this one is ${bom.status})`);
          }
          if (dto.rowVersion !== undefined && dto.rowVersion !== bom.rowVersion) throw rowVersionConflict();
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bom-release:${companyId}:${bom.parentItemId}:${bom.bomType}`}))`;

          const check = await this.runValidation(tx, bom, 'release');
          if (!check.valid) throw bomValidationError(check.errors);

          const current = await tx.bom.findFirst({
            where: {
              companyId,
              parentItemId: bom.parentItemId,
              bomType: bom.bomType,
              bomScope: bom.bomScope,
              status: BomStatus.RELEASED,
              isCurrentVersion: true,
              deletedAt: null,
              NOT: { bomId },
            },
          });
          if (current && current.rootBomId !== bom.rootBomId) {
            throw bomError(BOM_ERROR_CODES.PARENT_HAS_RELEASED_BOM, `Item already has released BOM ${current.bomNumber}. Create a revision of it instead.`, 'parentItemId');
          }

          await tx.$executeRaw`
            UPDATE bom_lines l
            SET item_code_snapshot = i.item_code, item_name_snapshot = i.description, uom_code_snapshot = u.code, updated_at = NOW()
            FROM items i, uoms u
            WHERE l.bom_id = ${bomId} AND i.item_id = l.component_item_id AND u.uom_id = l.uom_id`;

          const now = new Date();
          if (current) {
            await tx.bom.update({
              where: { bomId: current.bomId },
              data: {
                status: BomStatus.OBSOLETE,
                isCurrentVersion: false,
                obsoletedAt: now,
                obsoleteReason: `Superseded by version ${bom.version}`,
                updatedBy: actorId,
                updatedAt: now,
                rowVersion: { increment: 1 },
              },
            });
            await this.repository.writeHistory(tx, { companyId, bomId: current.bomId, from: BomStatus.RELEASED, to: BomStatus.OBSOLETE, actorId, reason: `Superseded by version ${bom.version}`, idempotencyKey });
          }
          await this.repository.touch(tx, bom, actorId, undefined, { status: BomStatus.RELEASED, isCurrentVersion: true, releasedAt: now, releasedBy: actorId });
          await this.repository.writeHistory(tx, { companyId, bomId, from: BomStatus.DRAFT, to: BomStatus.RELEASED, actorId, idempotencyKey });
          await this.repository.writeAudit(tx, {
            companyId,
            actorId,
            action: 'update',
            entityName: 'Bom',
            entityId: bomId,
            oldValue: { status: BomStatus.DRAFT },
            newValue: { status: BomStatus.RELEASED, version: bom.version, supersededBomId: current?.bomId ?? null, warnings: check.warnings.length },
          });
          return { bomId: bomId.toString(), warnings: check.warnings as unknown as Prisma.InputJsonValue };
        },
      );
      return result as { bomId: string; warnings: unknown };
    });
    return this.view.detail(companyId, BigInt(result.bomId), user, { releaseWarnings: result.warnings });
  }

  /** New DRAFT version from the RELEASED current one: lines copied with the same Common Keys. */
  async revise(companyId: bigint, bomId: bigint | null, dto: ReviseBomDto, user: AuthenticatedUser, idempotencyKey?: string) {
    if (!bomId) throw bomNotFound();
    const actorId = actorOf(user);
    const result = await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      const { result } = await this.idempotency.run(
        tx,
        { companyId, userId: actorId, endpoint: 'POST boms/:bomId/revisions', key: idempotencyKey, body: { bomId: bomId.toString(), ...dto } },
        async () => {
          const reason = dto.revisionReason?.trim();
          if (!reason) throw bomError(BOM_ERROR_CODES.REVISION_REASON_REQUIRED, 'Revision reason is required', 'revisionReason');
          if (bom.status !== BomStatus.RELEASED || !bom.isCurrentVersion) {
            throw bomError(BOM_ERROR_CODES.INVALID_STATUS_TRANSITION, 'Only the current RELEASED version can be revised');
          }
          if (dto.rowVersion !== undefined && dto.rowVersion !== bom.rowVersion) throw rowVersionConflict();
          const open = await tx.bom.findFirst({ where: { companyId, rootBomId: bom.rootBomId, status: BomStatus.DRAFT, deletedAt: null } });
          if (open) {
            throw bomError(BOM_ERROR_CODES.OPEN_REVISION_EXISTS, `Version ${open.version} is already open as a draft`);
          }
          const maxVersion = await tx.bom.aggregate({ where: { companyId, bomNumber: bom.bomNumber }, _max: { version: true } });
          const draft = await tx.bom.create({
            data: {
              companyId,
              bomNumber: bom.bomNumber,
              parentItemId: bom.parentItemId,
              bomType: bom.bomType,
              bomScope: bom.bomScope,
              baseQuantity: bom.baseQuantity,
              uomId: bom.uomId,
              version: (maxVersion._max.version ?? bom.version) + 1,
              revisionLabel: dto.revisionLabel ?? null,
              revisionReason: reason,
              rootBomId: bom.rootBomId ?? bom.bomId,
              previousVersionId: bom.bomId,
              isCurrentVersion: false,
              isDefault: bom.isDefault,
              status: BomStatus.DRAFT,
              effectiveFrom: bom.effectiveFrom,
              effectiveTo: bom.effectiveTo,
              nextCommonKey: bom.nextCommonKey,
              sourceType: bom.sourceType,
              sourceId: bom.sourceId,
              remarks: bom.remarks,
              createdBy: actorId,
            },
          });
          await this.copyLines(tx, bom.bomId, draft);
          await this.repository.writeHistory(tx, { companyId, bomId: draft.bomId, from: null, to: BomStatus.DRAFT, actorId, reason, idempotencyKey });
          await this.repository.writeAudit(tx, {
            companyId,
            actorId,
            action: 'create',
            entityName: 'Bom',
            entityId: draft.bomId,
            newValue: { bomNumber: draft.bomNumber, version: draft.version, previousVersionId: bom.bomId, revisionReason: reason },
          });
          return { bomId: draft.bomId.toString() };
        },
      );
      return result as { bomId: string };
    });
    return this.view.detail(companyId, BigInt(result.bomId), user);
  }

  async obsolete(companyId: bigint, bomId: bigint | null, dto: ReasonDto, user: AuthenticatedUser, idempotencyKey?: string) {
    if (!bomId) throw bomNotFound();
    const actorId = actorOf(user);
    await this.repository.transaction(async (tx) => {
      const bom = await this.repository.lockBom(tx, companyId, bomId);
      await this.idempotency.run(
        tx,
        { companyId, userId: actorId, endpoint: 'POST boms/:bomId/obsolete', key: idempotencyKey, body: { bomId: bomId.toString(), ...dto } },
        async () => {
          const reason = this.requireReason(dto.reason);
          if (bom.status !== BomStatus.RELEASED) {
            throw bomError(BOM_ERROR_CODES.INVALID_STATUS_TRANSITION, `Only a RELEASED BOM can be made obsolete (this one is ${bom.status})`);
          }
          const now = new Date();
          await this.repository.touch(tx, bom, actorId, dto.rowVersion, {
            status: BomStatus.OBSOLETE,
            isCurrentVersion: false,
            obsoletedAt: now,
            obsoleteReason: reason,
          });
          await this.repository.writeHistory(tx, { companyId, bomId, from: BomStatus.RELEASED, to: BomStatus.OBSOLETE, actorId, reason, idempotencyKey });
          await this.repository.writeAudit(tx, { companyId, actorId, action: 'update', entityName: 'Bom', entityId: bomId, oldValue: { status: BomStatus.RELEASED }, newValue: { status: BomStatus.OBSOLETE, reason } });
          return { bomId: bomId.toString() };
        },
      );
    });
    return this.view.detail(companyId, bomId, user);
  }

  // ---------------------------------------------------------------- calculations

  async requirements(companyId: bigint, bomId: bigint | null, dto: RequirementsDto) {
    if (!bomId) throw bomNotFound();
    const productionQuantity = toDecimal(dto.productionQuantity);
    const qtyIssues = checkQuantity(productionQuantity, 'productionQuantity', 'Production quantity');
    if (qtyIssues.length) throw bomValidationError(qtyIssues);
    const db = this.repository.db;
    const bom = await db.bom.findFirst({
      where: { bomId, companyId, deletedAt: null },
      include: {
        lines: {
          include: {
            componentItem: { select: { itemCode: true, oldCode: true, description: true, inventoryUomId: true } },
            uom: { select: { code: true } },
          },
        },
      },
    });
    if (!bom) throw bomNotFound();
    const snapshot = bom.status !== BomStatus.DRAFT;
    for (const l of bom.lines) {
      if (l.componentItem.inventoryUomId !== l.uomId) {
        throw bomError(BOM_ERROR_CODES.UOM_CONVERSION_MISSING, `No UOM conversion for ${l.componentItem.itemCode}`, `lines.${l.bomLineId}`);
      }
    }
    const toInput = (l: (typeof bom.lines)[number]): RequirementLineInput => ({
      lineId: l.bomLineId.toString(),
      itemId: l.componentItemId.toString(),
      itemCode: (snapshot && l.itemCodeSnapshot) || l.componentItem.itemCode,
      oldCode: l.componentItem.oldCode,
      itemName: (snapshot && l.itemNameSnapshot) || l.componentItem.description,
      uomCode: (snapshot && l.uomCodeSnapshot) || l.uom.code,
      quantity: l.quantity,
      scrapPercentage: l.scrapPercentage,
      findNumber: l.findNumber,
    });
    const groups = buildGroups(bom.lines)
      .filter((g) => g.main)
      .map((g) => ({ commonKey: g.commonKey, main: toInput(g.main!), subLines: g.subLines.map(toInput) }));
    return {
      bomId: bom.bomId.toString(),
      bomNumber: bom.bomNumber,
      version: bom.version,
      status: bom.status,
      ...computeRequirements({ productionQuantity: productionQuantity!, baseQuantity: bom.baseQuantity, groups }),
    };
  }

  /** BOMs and groups that use the item (as MAIN or SUB). Current released versions by default. */
  async whereUsed(companyId: bigint, query: WhereUsedQueryDto) {
    const db = this.repository.db;
    const itemId = BigInt(query.itemId);
    const item = await db.item.findFirst({ where: { itemId, companyId, deletedAt: null }, select: { itemId: true, itemCode: true, oldCode: true, description: true } });
    if (!item) throw bomError(BOM_ERROR_CODES.COMPONENT_NOT_FOUND, 'Item not found', 'itemId');
    const statusFilter: Prisma.BomWhereInput = query.includeDrafts
      ? { OR: [{ isCurrentVersion: true }, { status: BomStatus.DRAFT }] }
      : { isCurrentVersion: true };
    const lines = await db.bomLine.findMany({
      where: { companyId, componentItemId: itemId, bom: { deletedAt: null, ...statusFilter } },
      include: {
        bom: {
          select: {
            bomId: true,
            bomNumber: true,
            version: true,
            status: true,
            bomType: true,
            parentItem: { select: { itemId: true, itemCode: true, oldCode: true, description: true, machine: { select: { machineCode: true } } } },
          },
        },
        parentLine: { select: { bomLineId: true, componentItem: { select: { itemId: true, itemCode: true, oldCode: true, description: true } } } },
      },
      orderBy: [{ bomId: 'asc' }, { lineNumber: 'asc' }],
    });
    const byBom = new Map<string, { bom: (typeof lines)[number]['bom']; usages: unknown[] }>();
    for (const l of lines) {
      const key = l.bomId.toString();
      const entry = byBom.get(key) ?? { bom: l.bom, usages: [] };
      entry.usages.push({
        lineId: l.bomLineId,
        lineType: l.lineType,
        commonKey: l.commonKey,
        quantity: l.quantity.toFixed(6),
        findNumber: l.findNumber,
        mainItem: l.parentLine
          ? { itemId: l.parentLine.componentItem.itemId, itemCode: l.parentLine.componentItem.itemCode, oldCode: l.parentLine.componentItem.oldCode, name: l.parentLine.componentItem.description }
          : null,
      });
      byBom.set(key, entry);
    }
    return serialize({
      item: { itemId: item.itemId, itemCode: item.itemCode, oldCode: item.oldCode, name: item.description },
      boms: [...byBom.values()].map(({ bom, usages }) => ({
        bomId: bom.bomId,
        bomNumber: bom.bomNumber,
        version: bom.version,
        status: bom.status,
        bomType: bom.bomType,
        parentItem: {
          itemId: bom.parentItem.itemId,
          itemCode: bom.parentItem.itemCode,
          oldCode: bom.parentItem.oldCode,
          name: bom.parentItem.description,
          machineCode: bom.parentItem.machine?.machineCode ?? null,
        },
        usages,
      })),
    });
  }

  async byItem(companyId: bigint, itemId: bigint | null, query: ByItemQueryDto, user: AuthenticatedUser) {
    if (!itemId) throw bomNotFound();
    // STANDARD for a base item; a customised machine's item only has CUSTOMER BOMs.
    const bom = await this.repository.db.bom.findFirst({
      where: {
        companyId,
        parentItemId: itemId,
        status: BomStatus.RELEASED,
        isCurrentVersion: true,
        deletedAt: null,
        ...(query.bomType ? { bomType: query.bomType } : {}),
      },
      orderBy: [{ bomScope: 'asc' }, { bomType: 'desc' }],
    });
    if (!bom) throw bomNotFound();
    return this.view.detail(companyId, bom.bomId, user);
  }

  /**
   * CUSTOMER BOM DRAFT for a customised machine, copied from the base machine's released BOM
   * (same groups and Common Keys). Runs in the caller's transaction (machine variant creation).
   */
  async createCustomerCopyInTx(
    tx: Db,
    params: {
      companyId: bigint;
      baseBom: Bom;
      parentItemId: bigint;
      uomId: bigint;
      customerId: bigint | null;
      notes: string | null;
      sourceDocumentType: string;
      actorId: bigint | null;
    },
  ): Promise<Bom> {
    const { companyId, baseBom, actorId } = params;
    const bomNumber = await this.documentNumbers.reserve(tx, companyId, 'BOM');
    const created = await tx.bom.create({
      data: {
        companyId,
        bomNumber,
        parentItemId: params.parentItemId,
        bomType: baseBom.bomType,
        bomScope: 'CUSTOMER',
        baseQuantity: baseBom.baseQuantity,
        uomId: params.uomId,
        status: BomStatus.DRAFT,
        nextCommonKey: baseBom.nextCommonKey,
        sourceType: 'CUSTOMER_COPY',
        sourceId: baseBom.bomId,
        baseBomId: baseBom.bomId,
        baseVersionNo: baseBom.version,
        customerId: params.customerId,
        sourceDocumentType: params.sourceDocumentType,
        customizationNotes: params.notes,
        remarks: `Copied from ${baseBom.bomNumber} v${baseBom.version}.`,
        createdBy: actorId,
      },
    });
    const bom = await tx.bom.update({ where: { bomId: created.bomId }, data: { rootBomId: created.bomId } });
    await this.copyLines(tx, baseBom.bomId, bom);
    await this.repository.writeHistory(tx, { companyId, bomId: bom.bomId, from: null, to: BomStatus.DRAFT, actorId, reason: `Customer copy of ${baseBom.bomNumber} v${baseBom.version}` });
    await this.repository.writeAudit(tx, {
      companyId,
      actorId,
      action: 'create',
      entityName: 'Bom',
      entityId: bom.bomId,
      newValue: { bomNumber, bomScope: 'CUSTOMER', baseBomId: baseBom.bomId, baseVersionNo: baseBom.version, parentItemId: params.parentItemId },
    });
    return bom;
  }

  // ---------------------------------------------------------------- helpers

  private requireReason(reason: string | undefined): string {
    const value = reason?.trim();
    if (!value) throw bomError(BOM_ERROR_CODES.REASON_REQUIRED, 'A reason is required', 'reason');
    return value;
  }

  private async assertNoReleasedBom(tx: Db, companyId: bigint, parentItemId: bigint, bomType: Bom['bomType']) {
    const existing = await tx.bom.findFirst({
      where: { companyId, parentItemId, bomType, bomScope: 'STANDARD', status: BomStatus.RELEASED, isCurrentVersion: true, deletedAt: null },
      select: { bomId: true, bomNumber: true, version: true },
    });
    if (existing) {
      throw bomError(
        BOM_ERROR_CODES.PARENT_HAS_RELEASED_BOM,
        `This item already has released BOM ${existing.bomNumber} (version ${existing.version}). Create a revision of it instead.`,
        'parentItemId',
        { lineId: undefined },
      );
    }
  }

  private async runValidation(db: Db, bom: Bom, mode: 'draft' | 'release') {
    const lines = await this.repository.loadLines(db, bom.bomId);
    const items = await this.repository.loadItems(db, bom.companyId, [bom.parentItemId, ...lines.map((l) => l.componentItemId)]);
    const procurement = await loadProcurementTypes(db, bom.companyId, [bom.parentItemId, ...lines.map((l) => l.componentItemId)]);
    return validateBom({
      mode,
      header: {
        parentItemId: bom.parentItemId.toString(),
        uomId: bom.uomId.toString(),
        baseQuantity: bom.baseQuantity,
        version: bom.version,
        revisionReason: bom.revisionReason,
        effectiveFrom: bom.effectiveFrom,
        effectiveTo: bom.effectiveTo,
      },
      items,
      procurement,
      lines: lines.map((l) => ({
        bomLineId: l.bomLineId,
        lineType: l.lineType,
        commonKey: l.commonKey,
        parentLineId: l.parentLineId,
        lineNumber: l.lineNumber,
        componentItemId: l.componentItemId.toString(),
        quantity: l.quantity,
        scrapPercentage: l.scrapPercentage,
        uomId: l.uomId.toString(),
      })),
    });
  }

  /** MAIN lines first (old id -> new id), then SUB lines with the remapped parentLineId. Same keys. */
  private async copyLines(tx: Db, fromBomId: bigint, to: Bom) {
    const source = await this.repository.loadLines(tx, fromBomId);
    const base = (l: (typeof source)[number]) => ({
      companyId: to.companyId,
      bomId: to.bomId,
      lineType: l.lineType,
      commonKey: l.commonKey,
      componentItemId: l.componentItemId,
      quantity: l.quantity,
      uomId: l.uomId,
      lineNumber: l.lineNumber,
      findNumber: l.findNumber,
      scrapPercentage: l.scrapPercentage,
      remarks: l.remarks,
    });
    const mains = source.filter((l) => l.lineType === 'MAIN');
    const newMains = mains.length
      ? await tx.bomLine.createManyAndReturn({ data: mains.map((l) => ({ ...base(l), parentLineId: null })), select: { bomLineId: true, commonKey: true } })
      : [];
    const newIdByKey = new Map(newMains.map((m) => [m.commonKey, m.bomLineId]));
    const oldKeyById = new Map(mains.map((m) => [m.bomLineId.toString(), m.commonKey]));
    const subs = source.filter((l) => l.lineType === 'SUB');
    if (subs.length) {
      await tx.bomLine.createMany({
        data: subs.map((l) => {
          const parentLineId = newIdByKey.get(oldKeyById.get(l.parentLineId!.toString()) ?? '');
          if (!parentLineId) throw bomError(BOM_ERROR_CODES.MAIN_LINE_NOT_FOUND, `SUB line ${l.bomLineId} has no MAIN to copy under`);
          return { ...base(l), parentLineId };
        }),
      });
    }
  }
}

function pickHeader(b: Bom) {
  return {
    bomNumber: b.bomNumber,
    version: b.version,
    status: b.status,
    parentItemId: b.parentItemId.toString(),
    bomType: b.bomType,
    baseQuantity: b.baseQuantity.toString(),
    uomId: b.uomId.toString(),
    effectiveFrom: b.effectiveFrom,
    effectiveTo: b.effectiveTo,
    revisionLabel: b.revisionLabel,
    revisionReason: b.revisionReason,
    remarks: b.remarks,
    rowVersion: b.rowVersion,
  };
}
