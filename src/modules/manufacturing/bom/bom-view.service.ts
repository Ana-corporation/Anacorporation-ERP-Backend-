import { Injectable } from '@nestjs/common';
import { Bom, BomStatus } from '@prisma/client';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { serialize } from '@/common/utils/bigint.util';
import { checkPermissionCode } from '@/common/utils/permission-check.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { loadProcurementTypes } from '@/modules/inventory/item-master/item-procurement.util';
import { BomAction, bomNotFound } from './bom.constants';
import { buildGroups } from './bom-groups';
import { BomsRepository, Db } from './boms.repository';

const lineInclude = {
  componentItem: {
    select: {
      itemId: true,
      itemCode: true,
      oldCode: true,
      description: true,
      isActive: true,
      status: true,
      itemGroupRef: { select: { itemGroupId: true, name: true, categoryCode: true } },
      storeCategory: { select: { storeCategoryId: true, name: true } },
      materialStage: true,
      nextStageItem: {
        where: { deletedAt: null },
        select: {
          itemId: true,
          itemCode: true,
          materialStage: true,
          itemGroupRef: { select: { categoryCode: true } },
          nextStageItem: {
            where: { deletedAt: null },
            select: { itemId: true, itemCode: true, materialStage: true, itemGroupRef: { select: { categoryCode: true } } },
          },
        },
      },
    },
  },
  uom: { select: { uomId: true, code: true } },
} as const;

type StageRef = {
  itemId: bigint;
  itemCode: string;
  materialStage: string | null;
  itemGroupRef?: { categoryCode: string | null } | null;
};

/**
 * Part numbers of a made part: RM + process (PLT/MCN/FAB/…).
 * Each slot includes categoryCode so the UI labels PLT/MCN (not a generic "SF").
 * Soft-deleted old ANASF/ANAFF links are excluded. `ff` only for leftover old chains.
 */
function stageChain(
  item: {
    itemId: bigint;
    itemCode: string;
    materialStage: string | null;
    itemGroupRef?: { categoryCode: string | null } | null;
    nextStageItem: (StageRef & { nextStageItem: StageRef | null }) | null;
  },
) {
  if (!item.materialStage && !item.nextStageItem) return null;
  const chain: Record<'rm' | 'sf' | 'ff', { itemId: bigint; itemCode: string; categoryCode: string | null } | null> = {
    rm: null,
    sf: null,
    ff: null,
  };
  const put = (ref: StageRef | null | undefined) => {
    const stage = ref?.materialStage?.toLowerCase();
    if (ref && (stage === 'rm' || stage === 'sf' || stage === 'ff')) {
      chain[stage] = {
        itemId: ref.itemId,
        itemCode: ref.itemCode,
        categoryCode: ref.itemGroupRef?.categoryCode ?? null,
      };
    }
  };
  put(item);
  put(item.nextStageItem);
  put(item.nextStageItem?.nextStageItem ?? null);
  return chain;
}

export interface AllowedActionsContext {
  hasOpenDraft: boolean;
}

/** Status + permission → buttons the client may show. The server still checks every action. */
export function computeAllowedActions(
  bom: Pick<Bom, 'status' | 'isCurrentVersion'>,
  user: AuthenticatedUser,
  ctx: AllowedActionsContext,
): BomAction[] {
  const can = (code: string) => checkPermissionCode(user, code);
  const actions: BomAction[] = [];
  if (can('boms:view')) actions.push('validate', 'requirements');
  if (bom.status === BomStatus.DRAFT) {
    if (can('boms:edit')) actions.push('edit', 'addMain', 'addSub', 'editLine', 'deleteLine', 'cancel');
    if (can('boms:release')) actions.push('release');
    if (can('boms:delete')) actions.push('delete');
  } else if (bom.status === BomStatus.RELEASED) {
    if (bom.isCurrentVersion && !ctx.hasOpenDraft && can('boms:revise')) actions.push('revise');
    if (can('boms:obsolete')) actions.push('obsolete');
  } else {
    return actions.filter((a) => a === 'requirements');
  }
  if (bom.status !== BomStatus.DRAFT) return actions.filter((a) => a !== 'validate');
  return actions;
}

@Injectable()
export class BomViewService {
  constructor(
    private readonly repository: BomsRepository,
    private readonly auditService: AuditService,
  ) {}

  async hasOpenDraft(db: Db, companyId: bigint, rootBomId: bigint | null) {
    if (!rootBomId) return false;
    return (await db.bom.count({ where: { companyId, rootBomId, status: BomStatus.DRAFT, deletedAt: null } })) > 0;
  }

  /** Header + groups (MAIN with its SUB lines). Drafts read live item data; released versions use the snapshots. */
  async detail(companyId: bigint, bomId: bigint, user: AuthenticatedUser, extra: Record<string, unknown> = {}) {
    const db = this.repository.db;
    const bom = await db.bom.findFirst({
      where: { bomId, companyId, deletedAt: null },
      include: {
        parentItem: { select: { itemId: true, itemCode: true, oldCode: true, description: true, isActive: true, status: true } },
        uom: { select: { uomId: true, code: true } },
        lines: { include: lineInclude, orderBy: [{ lineNumber: 'asc' }, { bomLineId: 'asc' }] },
      },
    });
    if (!bom) throw bomNotFound();

    const procurement = await loadProcurementTypes(db, companyId, [
      bom.parentItemId,
      ...bom.lines.map((l) => l.componentItemId),
    ]);
    const useSnapshot = bom.status !== BomStatus.DRAFT;
    const lineView = (l: (typeof bom.lines)[number]) => ({
      lineId: l.bomLineId,
      lineType: l.lineType,
      commonKey: l.commonKey,
      parentLineId: l.parentLineId,
      lineNumber: l.lineNumber,
      findNumber: l.findNumber,
      componentItemId: l.componentItemId,
      itemCode: (useSnapshot && l.itemCodeSnapshot) || l.componentItem.itemCode,
      /** Previous / drawing part number from the Item Master (e.g. BS5018030010) */
      oldCode: l.componentItem.oldCode,
      itemName: (useSnapshot && l.itemNameSnapshot) || l.componentItem.description,
      uomId: l.uomId,
      uomCode: (useSnapshot && l.uomCodeSnapshot) || l.uom.code,
      quantity: l.quantity.toFixed(6),
      scrapPercentage: l.scrapPercentage.toFixed(4),
      remarks: l.remarks,
      itemActive: l.componentItem.isActive && l.componentItem.status !== 'inactive',
      itemStatus: l.componentItem.status,
      itemGroup: l.componentItem.itemGroupRef,
      storeCategory: l.componentItem.storeCategory,
      procurementType: procurement.byItemId.get(l.componentItemId.toString()) ?? null,
      stages: stageChain(l.componentItem),
      snapshot: useSnapshot
        ? { itemCode: l.itemCodeSnapshot, itemName: l.itemNameSnapshot, uomCode: l.uomCodeSnapshot }
        : null,
    });
    const groups = buildGroups(bom.lines).map((g) => ({
      commonKey: g.commonKey,
      main: g.main ? lineView(g.main) : null,
      subLines: g.subLines.map(lineView),
    }));

    const { lines, parentItem, uom, ...header } = bom;
    const openDraft = await this.hasOpenDraft(db, companyId, bom.rootBomId);
    const [machine, customer, baseBom] = await Promise.all([
      db.machine.findFirst({
        where: { companyId, itemId: bom.parentItemId, deletedAt: null },
        select: { machineId: true, machineCode: true, name: true, machineType: true, salesOrderNo: true, baseMachine: { select: { machineId: true, machineCode: true } } },
      }),
      bom.customerId ? db.customer.findFirst({ where: { customerId: bom.customerId, companyId }, select: { customerId: true, customerCode: true, name: true } }) : null,
      bom.baseBomId ? db.bom.findFirst({ where: { bomId: bom.baseBomId, companyId }, select: { bomId: true, bomNumber: true, version: true } }) : null,
    ]);
    const record = {
      ...header,
      baseQuantity: bom.baseQuantity.toFixed(6),
      uom,
      parentItem: {
        itemId: parentItem.itemId,
        itemCode: parentItem.itemCode,
        oldCode: parentItem.oldCode,
        name: parentItem.description,
        isActive: parentItem.isActive && parentItem.status !== 'inactive',
        procurementType: procurement.byItemId.get(parentItem.itemId.toString()) ?? null,
      },
      machine: machine
        ? {
            machineId: machine.machineId,
            machineCode: machine.machineCode,
            name: machine.name,
            machineType: machine.machineType,
            salesOrderNo: machine.salesOrderNo,
            baseMachineId: machine.baseMachine?.machineId ?? null,
            baseMachineCode: machine.baseMachine?.machineCode ?? null,
          }
        : null,
      customer,
      baseBom,
      groups,
      summary: {
        groupCount: groups.filter((g) => g.main).length,
        lineCount: lines.length,
        subLineCount: lines.filter((l) => l.lineType === 'SUB').length,
      },
      hasOpenDraft: openDraft,
      allowedActions: computeAllowedActions(bom, user, { hasOpenDraft: openDraft }),
      ...extra,
    };
    const names = await this.auditService.loadActorNames(bom.releasedBy ? [bom.releasedBy.toString()] : []);
    return this.auditService.withAudit({
      ...(serialize(record) as unknown as Record<string, unknown>),
      releasedByName: bom.releasedBy ? names.get(bom.releasedBy.toString()) ?? null : null,
    });
  }
}
