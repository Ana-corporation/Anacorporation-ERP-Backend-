import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import type { CreateItemDto } from './dto/item.dto';

export const ITEM_STAGE_ERROR_CODES = {
  NOT_RM: 'ITEM_STAGE_NOT_RM',
  CATEGORY_MISSING: 'ITEM_STAGE_CATEGORY_MISSING',
  PROCESS_REQUIRED: 'ITEM_STAGE_PROCESS_REQUIRED',
} as const;

/**
 * What to create with a raw-material item:
 * - RM_ONLY: one part number (RM)
 * - RM_PROCESS: two part numbers — RM + the process category (PLT / MCN / FAB / SPR / …)
 * Three-part RM → SF → FF is not used for mechanical parts.
 */
export const ITEM_STAGE_PLANS = ['RM_ONLY', 'RM_PROCESS'] as const;
export type ItemStagePlan = (typeof ITEM_STAGE_PLANS)[number];

/** Item custom fields set on the process (SF-stage) item when the company defines them. */
const PROCESS_FIELD_VALUES: Record<string, string> = {
  procurementType: 'Make',
  materialType: 'Semi-Finished',
};

const stageError = (code: string, message: string, field = 'processCategoryCode') =>
  new BusinessException(message, HttpStatus.BAD_REQUEST, [{ field, message }], code);

type CreateInTx = (
  tx: Prisma.TransactionClient,
  companyId: string,
  dto: CreateItemDto,
  actorId: string,
) => Promise<{ itemId: bigint; itemCode: string }>;

/**
 * Creates the missing process-stage item of a raw-material item inside the caller's transaction.
 * The process item gets its own part number from the chosen process category (PLT / MCN / …),
 * points back to the RM item, and copies name / old code / unit / custom fields.
 * Returns the created items (empty when the process item already exists).
 */
export async function createStageItems(
  tx: Prisma.TransactionClient,
  createInTransaction: CreateInTx,
  params: {
    companyId: bigint;
    itemId: bigint;
    /** Process category code from the BOM sheet, e.g. PLT, MCN, FAB, SPR */
    processCategoryCode: string;
    actorId: string;
  },
) {
  const { companyId, itemId, actorId } = params;
  const processCategoryCode = params.processCategoryCode.trim().toUpperCase();
  if (!processCategoryCode) {
    throw stageError(ITEM_STAGE_ERROR_CODES.PROCESS_REQUIRED, 'Process category code is required (e.g. PLT, MCN)');
  }

  await tx.$queryRaw`SELECT item_id FROM items WHERE item_id = ${itemId} FOR UPDATE`;
  const rm = await tx.item.findFirst({
    where: { itemId, companyId, deletedAt: null },
    select: {
      itemId: true,
      itemCode: true,
      description: true,
      oldCode: true,
      inventoryUomId: true,
      inventoryJson: true,
      materialStage: true,
      itemGroupRef: { select: { materialStage: true } },
      nextStageItem: { select: { itemId: true, itemCode: true, itemGroupRef: { select: { categoryCode: true } } } },
    },
  });
  if (!rm) throw stageError(ITEM_STAGE_ERROR_CODES.NOT_RM, 'Item not found', 'itemId');
  const isRm = rm.materialStage === 'RM' || (!rm.materialStage && rm.itemGroupRef?.materialStage === 'RM');
  if (!isRm) {
    throw stageError(ITEM_STAGE_ERROR_CODES.NOT_RM, `${rm.itemCode} is not a raw-material (RM) stage item`, 'itemId');
  }

  // Already has a next stage: keep it (idempotent). Process category must match when present.
  if (rm.nextStageItem) {
    const existingCode = rm.nextStageItem.itemGroupRef?.categoryCode?.toUpperCase() ?? null;
    if (existingCode && existingCode !== processCategoryCode) {
      throw stageError(
        ITEM_STAGE_ERROR_CODES.CATEGORY_MISSING,
        `${rm.itemCode} already has process part ${rm.nextStageItem.itemCode} in category ${existingCode}`,
      );
    }
    return [];
  }

  const group = await tx.itemGroup.findFirst({
    where: {
      companyId,
      deletedAt: null,
      isActive: true,
      categoryCode: { equals: processCategoryCode, mode: 'insensitive' },
    },
    select: { itemGroupId: true, storeCategoryId: true, materialStage: true, name: true, categoryCode: true },
  });
  if (!group) {
    throw stageError(
      ITEM_STAGE_ERROR_CODES.CATEGORY_MISSING,
      `No category with code ${processCategoryCode}. Create it in Category Master and set Stage = SF`,
    );
  }

  if (rm.materialStage !== 'RM') await tx.item.update({ where: { itemId: rm.itemId }, data: { materialStage: 'RM' } });

  const sourceValues = await tx.customFieldValue.findMany({
    where: { companyId, entityType: 'item', recordId: rm.itemId },
    select: { fieldId: true, valueText: true, valueNumber: true, valueDate: true, valueBool: true, valueJson: true },
  });
  const stageDefs = await tx.customFieldDefinition.findMany({
    where: {
      companyId,
      entityType: 'item',
      deletedAt: null,
      isActive: true,
      fieldName: { in: ['procurementType', 'materialType'] },
    },
    select: { fieldId: true, fieldName: true, fieldType: true, options: true },
  });

  const uomName = (rm.inventoryJson as { uomName?: string } | null)?.uomName;
  const item = await createInTransaction(
    tx,
    companyId.toString(),
    {
      description: rm.description,
      oldCode: rm.oldCode ?? undefined,
      itemType: 'item',
      storeCategoryId: group.storeCategoryId.toString(),
      itemGroupId: group.itemGroupId.toString(),
      inventoryUomId: rm.inventoryUomId?.toString(),
      inventory: uomName ? { uomName } : undefined,
      status: 'active',
      isInventoryItem: true,
      metadata: {
        source: 'MATERIAL_STAGE',
        stage: 'SF',
        processCategoryCode,
        fromItemCode: rm.itemCode,
        rmItemCode: rm.itemCode,
      },
    } as CreateItemDto,
    actorId,
  );
  await tx.item.update({
    where: { itemId: item.itemId },
    data: { materialStage: 'SF', previousStageItemId: rm.itemId },
  });

  if (sourceValues.length > 0) {
    await tx.customFieldValue.createMany({
      data: sourceValues.map((v) => ({
        companyId,
        entityType: 'item',
        recordId: item.itemId,
        fieldId: v.fieldId,
        valueText: v.valueText,
        valueNumber: v.valueNumber,
        valueDate: v.valueDate,
        valueBool: v.valueBool,
        valueJson: v.valueJson ?? Prisma.JsonNull,
      })),
      skipDuplicates: true,
    });
  }
  for (const def of stageDefs) {
    const wanted = PROCESS_FIELD_VALUES[def.fieldName];
    const options = Array.isArray(def.options) ? (def.options as Array<{ value?: string }>) : [];
    if (!wanted || (def.fieldType === 'dropdown' && !options.some((o) => o?.value === wanted))) continue;
    await tx.customFieldValue.upsert({
      where: { fieldId_recordId: { fieldId: def.fieldId, recordId: item.itemId } },
      update: { valueText: wanted, updatedAt: new Date() },
      create: { companyId, entityType: 'item', recordId: item.itemId, fieldId: def.fieldId, valueText: wanted },
    });
  }

  await tx.userAudit.create({
    data: {
      companyId,
      performedBy: BigInt(actorId),
      action: 'create',
      entityName: 'Item',
      entityId: item.itemId,
      newValue: {
        itemCode: item.itemCode,
        description: rm.description,
        materialStage: 'SF',
        processCategoryCode,
        previousStageItemCode: rm.itemCode,
        source: 'MATERIAL_STAGE',
      },
    },
  });

  return [{ itemId: item.itemId, itemCode: item.itemCode, stage: 'SF' as const, processCategoryCode }];
}
