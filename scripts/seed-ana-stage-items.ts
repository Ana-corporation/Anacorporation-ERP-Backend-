/**
 * RM + one process stage for the made (RM) parts of a machine BOM (two part numbers only).
 *   e.g. --processCategoryCode MCN  → ANARM… + ANAMCN…
 * Process categories (PLT / MCN / FAB / SPR / …) are Stage = SF in Category Master.
 * No FF part is created. The BOM line keeps the RM item.
 *
 * Prefer creating new parts via Item Master stagePlan=RM_PROCESS + processCategoryCode.
 * This script is for a one-shot backfill when every RM on a BOM shares the same process.
 *
 * Run (DEV first):
 *   node scripts/with-node-env.js development node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js --transpile-only \
 *     scripts/seed-ana-stage-items.ts --companyId 28 --bom BOM00001 --processCategoryCode MCN --dry-run
 */
import { Prisma } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { CreateItemDto } from '@/modules/inventory/item-master/dto/item.dto';
import { ItemsRepository } from '@/modules/inventory/item-master/items.repository';
import { ItemsService } from '@/modules/inventory/item-master/items.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { PartNumberGeneratorService } from '@/modules/shared/number-series/part-number-generator.service';

const ADMIN_EMAIL = 'jegan@anamachinery.com';
const RM_CATEGORY = 'RM';
const CHUNK = 20;
const TX = { timeout: 180_000, maxWait: 30_000 };

function parseArgs(argv: string[]) {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const companyId = val('--companyId');
  const bom = val('--bom');
  const processCategoryCode = (val('--processCategoryCode') ?? '').trim().toUpperCase();
  if (!companyId || !/^\d+$/.test(companyId) || !bom || !/^[A-Z]{2,4}$/.test(processCategoryCode)) {
    throw new Error(
      'Usage: seed-ana-stage-items.ts --companyId <id> --bom <BOM number> --processCategoryCode <PLT|MCN|FAB|SPR> [--dry-run]',
    );
  }
  return { companyId: BigInt(companyId), bomNumber: bom, processCategoryCode, dryRun: argv.includes('--dry-run') };
}

async function main() {
  const { companyId, bomNumber, processCategoryCode, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  const log = (msg: string) => console.log(`${dryRun ? 'PLAN' : 'DONE'}  ${msg}`);

  try {
    const company = await prisma.company.findFirst({ where: { companyId, deletedAt: null }, select: { companyCode: true } });
    if (!company) throw new Error(`Company ${companyId} not found`);
    const admin = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL }, select: { userId: true } });
    if (!admin) throw new Error(`User ${ADMIN_EMAIL} not found`);
    console.log(`Company ${companyId} (${company.companyCode}) · ${bomNumber} · process ${processCategoryCode}${dryRun ? ' — DRY RUN' : ''}`);

    const bom = await prisma.bom.findFirst({
      where: { companyId, bomNumber, deletedAt: null },
      orderBy: { version: 'desc' },
      select: { bomId: true, version: true },
    });
    if (!bom) throw new Error(`${bomNumber} not found`);
    const lines = await prisma.bomLine.findMany({
      where: { bomId: bom.bomId, componentItem: { itemGroupRef: { categoryCode: RM_CATEGORY } } },
      select: { componentItemId: true },
    });
    const rmIds = [...new Set(lines.map((l) => l.componentItemId.toString()))].map(BigInt);
    const rmItems = await prisma.item.findMany({
      where: { itemId: { in: rmIds }, deletedAt: null },
      orderBy: { itemCode: 'asc' },
      select: {
        itemId: true,
        itemCode: true,
        oldCode: true,
        description: true,
        inventoryUomId: true,
        materialStage: true,
        inventoryUom: { select: { code: true } },
        nextStageItem: { select: { itemId: true, itemCode: true, itemGroupRef: { select: { categoryCode: true } } } },
      },
    });
    console.log(`RM parts: ${rmItems.length}`);

    const config = await prisma.numberSeriesConfig.findUnique({
      where: { companyId_documentType: { companyId, documentType: 'ITEM' } },
      include: { lines: true },
    });
    if (!config || config.segmentSource !== 'ITEM_GROUP') throw new Error('ITEM number series with segment source Category is required');

    const group = await prisma.itemGroup.findFirst({
      where: { companyId, deletedAt: null, isActive: true, categoryCode: { equals: processCategoryCode, mode: 'insensitive' } },
      select: { itemGroupId: true, storeCategoryId: true, name: true, materialStage: true, categoryCode: true },
    });
    if (!group) throw new Error(`Category ${processCategoryCode} not found. Create it in Category Master (Stage = SF)`);
    if (!config.lines.some((l) => l.segmentRefId === group.itemGroupId)) {
      log(`series line ${processCategoryCode}`);
      if (!dryRun) {
        await prisma.numberSeriesLine.create({
          data: {
            numberSeriesConfigId: config.numberSeriesConfigId,
            companyId,
            segmentRefId: group.itemGroupId,
            segmentCode: processCategoryCode,
            serialLength: config.serialLengthDefault,
          },
        });
      }
    }

    const missing = rmItems.filter((i) => !i.nextStageItem);
    log(`create ${missing.length} ${processCategoryCode} process items for RM parts that have none yet`);
    if (dryRun) return;

    const items = new ItemsService(
      new ItemsRepository(prisma),
      new AuditService(prisma),
      {} as DataAccessPoliciesService,
      {} as StorageService,
      { persistCustomFields: async () => undefined } as unknown as CustomFieldsValuesService,
      new PartNumberGeneratorService(),
      { loadFieldOverrides: async () => ({ visibility: new Map(), registration: new Map(), order: new Map() }) } as never,
    );
    const defs = await prisma.customFieldDefinition.findMany({
      where: {
        companyId,
        entityType: 'item',
        deletedAt: null,
        isActive: true,
        fieldName: { in: ['procurementType', 'materialType', 'materialCategory'] },
      },
    });
    const allowed = (fieldName: string, value: string) => {
      const def = defs.find((d) => d.fieldName === fieldName);
      if (!def) return null;
      const options = Array.isArray(def.options) ? (def.options as Array<{ value?: string }>) : [];
      return def.fieldType !== 'dropdown' || options.some((o) => o?.value === value) ? def : null;
    };
    const categoryField = defs.find((d) => d.fieldName === 'materialCategory');

    const setFields = async (tx: Prisma.TransactionClient, itemId: bigint, values: Record<string, string | null | undefined>) => {
      for (const [fieldName, value] of Object.entries(values)) {
        if (!value) continue;
        const def = allowed(fieldName, value);
        if (!def) continue;
        await tx.customFieldValue.upsert({
          where: { fieldId_recordId: { fieldId: def.fieldId, recordId: itemId } },
          update: { valueText: value, updatedAt: new Date() },
          create: { companyId, entityType: 'item', recordId: itemId, fieldId: def.fieldId, valueText: value },
        });
      }
    };

    let made = 0;
    for (let i = 0; i < rmItems.length; i += CHUNK) {
      const part = rmItems.slice(i, i + CHUNK);
      await prisma.$transaction(async (tx) => {
        const categories = categoryField
          ? await tx.customFieldValue.findMany({
              where: { fieldId: categoryField.fieldId, recordId: { in: part.map((r) => r.itemId) } },
              select: { recordId: true, valueText: true },
            })
          : [];
        for (const rm of part) {
          if (rm.materialStage !== 'RM') await tx.item.update({ where: { itemId: rm.itemId }, data: { materialStage: 'RM' } });
          if (rm.nextStageItem) continue;
          const materialCategory = categories.find((c) => c.recordId === rm.itemId)?.valueText ?? null;
          const created = await items.createInTransaction(
            tx,
            companyId.toString(),
            {
              description: rm.description,
              oldCode: rm.oldCode ?? undefined,
              itemType: 'item',
              storeCategoryId: group.storeCategoryId.toString(),
              itemGroupId: group.itemGroupId.toString(),
              inventoryUomId: rm.inventoryUomId?.toString(),
              inventory: rm.inventoryUom ? { uomName: rm.inventoryUom.code } : undefined,
              status: 'active',
              metadata: {
                source: 'MATERIAL_STAGE',
                stage: 'SF',
                processCategoryCode,
                fromItemCode: rm.itemCode,
                rmItemCode: rm.itemCode,
              },
            } as CreateItemDto,
            admin.userId.toString(),
          );
          await tx.item.update({
            where: { itemId: created.itemId },
            data: { materialStage: 'SF', previousStageItemId: rm.itemId },
          });
          await setFields(tx, created.itemId, {
            procurementType: 'Make',
            materialType: 'Semi-Finished',
            materialCategory,
          });
          await tx.userAudit.create({
            data: {
              companyId,
              performedBy: admin.userId,
              action: 'create',
              entityName: 'Item',
              entityId: created.itemId,
              newValue: {
                itemCode: created.itemCode,
                description: rm.description,
                materialStage: 'SF',
                processCategoryCode,
                previousStageItemCode: rm.itemCode,
                source: 'MATERIAL_STAGE',
              },
            },
          });
          made++;
        }
      }, TX);
      console.log(`      ${Math.min(i + CHUNK, rmItems.length)} / ${rmItems.length} RM parts done`);
    }
    log(`created ${made} ${processCategoryCode} process items`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
