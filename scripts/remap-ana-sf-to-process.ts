/**
 * Remap old RM → SF → FF chains to RM → process (PLT/MCN/FAB/SPR/CMP) using the BS500 Excel map.
 * Keeps each ANARM… item. Soft-deletes linked ANASF… / ANAFF…. Creates one new process part.
 *
 * Dry-run (default):
 *   node scripts/with-node-env.js production node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js --transpile-only \
 *     scripts/remap-ana-sf-to-process.ts --companyId 28 --map scripts/tmp-bs500-process-map.json
 *
 * Apply:
 *   … scripts/remap-ana-sf-to-process.ts --companyId 28 --map … --apply
 */
import { readFileSync } from 'fs';
import { Prisma } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { createStageItems } from '@/modules/inventory/item-master/item-stages';
import { CreateItemDto } from '@/modules/inventory/item-master/dto/item.dto';
import { ItemsRepository } from '@/modules/inventory/item-master/items.repository';
import { ItemsService } from '@/modules/inventory/item-master/items.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { PartNumberGeneratorService } from '@/modules/shared/number-series/part-number-generator.service';

const ADMIN_EMAIL = 'jegan@anamachinery.com';
const CHUNK = 15;
const TX = { timeout: 180_000, maxWait: 30_000 };

type MapRow = { pn: string; desc: string; process: string };

function parseArgs(argv: string[]) {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const companyId = val('--companyId');
  const mapPath = val('--map');
  if (!companyId || !/^\d+$/.test(companyId) || !mapPath) {
    throw new Error('Usage: remap-ana-sf-to-process.ts --companyId <id> --map <json> [--apply] [--limit N]');
  }
  const limitRaw = val('--limit');
  return {
    companyId: BigInt(companyId),
    mapPath,
    apply: argv.includes('--apply'),
    limit: limitRaw ? Number(limitRaw) : undefined,
  };
}

async function main() {
  const { companyId, mapPath, apply, limit } = parseArgs(process.argv.slice(2));
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as MapRow[];
  const processByOldCode = new Map(map.map((r) => [r.pn.toUpperCase(), r.process.toUpperCase()]));
  const prisma = new PrismaService();
  const tag = apply ? 'APPLY' : 'PLAN';
  const log = (msg: string) => console.log(`${tag}  ${msg}`);

  try {
    const company = await prisma.company.findFirst({ where: { companyId, deletedAt: null }, select: { companyCode: true } });
    if (!company) throw new Error(`Company ${companyId} not found`);
    const admin = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL }, select: { userId: true } });
    if (!admin) throw new Error(`User ${ADMIN_EMAIL} not found`);
    console.log(`Company ${companyId} (${company.companyCode}) · map ${map.length} · ${apply ? 'APPLY' : 'DRY-RUN'}`);

    // Ensure process categories exist, Stage=SF, and have ITEM series lines
    const processes = [...new Set(map.map((r) => r.process.toUpperCase()))];
    const config = await prisma.numberSeriesConfig.findUnique({
      where: { companyId_documentType: { companyId, documentType: 'ITEM' } },
      include: { lines: true },
    });
    if (!config || config.segmentSource !== 'ITEM_GROUP') throw new Error('ITEM series with Category segment is required');

    // Many process categories (PLT/MCN/…) share Stage=SF — drop the old one-SF-per-company index if present.
    if (apply) {
      await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "item_groups_company_stage_uidx"');
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "item_groups_company_ff_stage_uidx"
          ON "item_groups"("company_id", "material_stage")
          WHERE "material_stage" = 'FF' AND "deleted_at" IS NULL`);
      log('opened many SF process categories (dropped one-SF unique index)');
    }

    const sfStore = await prisma.storeCategory.findFirst({
      where: { companyId, deletedAt: null, numberSeriesCode: 'SF' },
      select: { storeCategoryId: true, name: true },
    });
    if (!sfStore) throw new Error('Semi-Finished Store (series code SF) not found');

    const groupByProcess = new Map<string, { itemGroupId: bigint; storeCategoryId: bigint; categoryCode: string }>();
    for (const code of processes) {
      let group = await prisma.itemGroup.findFirst({
        where: { companyId, deletedAt: null, categoryCode: { equals: code, mode: 'insensitive' } },
        select: { itemGroupId: true, storeCategoryId: true, categoryCode: true, materialStage: true, name: true },
      });
      if (!group) {
        log(`create category ${code} in ${sfStore.name}`);
        if (apply) {
          group = await prisma.itemGroup.create({
            data: {
              companyId,
              storeCategoryId: sfStore.storeCategoryId,
              name: code === 'SPR' ? 'Springs' : code,
              categoryCode: code,
              description: `Process stage ${code}`,
              materialStage: 'SF',
              createdBy: admin.userId,
            },
            select: { itemGroupId: true, storeCategoryId: true, categoryCode: true, materialStage: true, name: true },
          });
        } else {
          groupByProcess.set(code, { itemGroupId: 0n, storeCategoryId: sfStore.storeCategoryId, categoryCode: code });
          continue;
        }
      }
      if (group.materialStage !== 'SF') {
        log(`set ${code} materialStage=SF`);
        if (apply) {
          await prisma.itemGroup.update({ where: { itemGroupId: group.itemGroupId }, data: { materialStage: 'SF' } });
        }
      }
      if (!config.lines.some((l) => l.segmentRefId === group!.itemGroupId)) {
        log(`add series line ${code}`);
        if (apply) {
          await prisma.numberSeriesLine.create({
            data: {
              numberSeriesConfigId: config.numberSeriesConfigId,
              companyId,
              segmentRefId: group.itemGroupId,
              segmentCode: code,
              serialLength: config.serialLengthDefault,
            },
          });
        }
      }
      groupByProcess.set(code, {
        itemGroupId: group.itemGroupId,
        storeCategoryId: group.storeCategoryId,
        categoryCode: group.categoryCode!,
      });
    }

    const rms = await prisma.item.findMany({
      where: { companyId, deletedAt: null, materialStage: 'RM', oldCode: { not: null } },
      orderBy: { itemCode: 'asc' },
      select: {
        itemId: true,
        itemCode: true,
        oldCode: true,
        description: true,
        inventoryUomId: true,
        inventoryJson: true,
        nextStageItem: {
          select: {
            itemId: true,
            itemCode: true,
            materialStage: true,
            itemGroupRef: { select: { categoryCode: true } },
            nextStageItem: { select: { itemId: true, itemCode: true, materialStage: true } },
          },
        },
      },
    });

    type Plan = {
      rm: string;
      oldCode: string;
      process: string;
      removeSf: string | null;
      removeFf: string | null;
      alreadyOk: boolean;
      skipReason?: string;
    };
    const plans: Plan[] = [];
    let unmatched = 0;
    for (const rm of rms) {
      const oldCode = (rm.oldCode ?? '').trim().toUpperCase();
      const process = processByOldCode.get(oldCode);
      if (!process) {
        unmatched++;
        continue;
      }
      const sf = rm.nextStageItem;
      const ff = sf?.nextStageItem ?? null;
      const sfCat = sf?.itemGroupRef?.categoryCode?.toUpperCase() ?? null;
      const alreadyOk = Boolean(sf && sfCat === process && !ff);
      plans.push({
        rm: rm.itemCode,
        oldCode,
        process,
        removeSf: alreadyOk ? null : sf?.itemCode ?? null,
        removeFf: ff?.itemCode ?? null,
        alreadyOk,
        skipReason: !groupByProcess.has(process) ? `missing category ${process}` : undefined,
      });
    }

    const work = plans.filter((p) => !p.alreadyOk && !p.skipReason);
    const limited = limit ? work.slice(0, limit) : work;
    const byProcess = new Map<string, number>();
    for (const p of work) byProcess.set(p.process, (byProcess.get(p.process) ?? 0) + 1);

    log(`RM with Excel oldCode: ${plans.length} · already OK: ${plans.filter((p) => p.alreadyOk).length} · to remap: ${work.length} · unmatched RM: ${unmatched}`);
    console.log('To remap by process:', Object.fromEntries(byProcess));
    console.log('Samples:', limited.slice(0, 8));
    if (!apply) {
      log('Dry-run only. Re-run with --apply to soft-delete old SF/FF and create process parts.');
      return;
    }

    // Stock guard: refuse if any SF/FF to remove still has a balance
    const removeIds = [
      ...new Set(
        limited.flatMap((p) => {
          const ids: string[] = [];
          // resolve from DB again below; collect codes for message only
          return ids;
        }),
      ),
    ];
    void removeIds;

    const items = new ItemsService(
      new ItemsRepository(prisma),
      new AuditService(prisma),
      {} as DataAccessPoliciesService,
      {} as StorageService,
      { persistCustomFields: async () => undefined } as unknown as CustomFieldsValuesService,
      new PartNumberGeneratorService(),
      { loadFieldOverrides: async () => ({ visibility: new Map(), registration: new Map(), order: new Map() }) } as never,
    );

    const rmByCode = new Map(rms.map((r) => [r.itemCode, r]));
    let done = 0;
    let created = 0;
    let removed = 0;

    for (let i = 0; i < limited.length; i += CHUNK) {
      const chunk = limited.slice(i, i + CHUNK);
      await prisma.$transaction(async (tx) => {
        for (const plan of chunk) {
          const rm = rmByCode.get(plan.rm);
          if (!rm) continue;

          // Reload chain inside tx
          const live = await tx.item.findFirst({
            where: { itemId: rm.itemId, deletedAt: null },
            select: {
              itemId: true,
              itemCode: true,
              nextStageItem: {
                select: {
                  itemId: true,
                  itemCode: true,
                  nextStageItem: { select: { itemId: true, itemCode: true } },
                },
              },
            },
          });
          if (!live) continue;

          const sf = live.nextStageItem;
          const ff = sf?.nextStageItem ?? null;
          const doomed = [ff, sf].filter(Boolean) as Array<{ itemId: bigint; itemCode: string }>;
          if (doomed.length) {
            const bal = await tx.stockBalance.findFirst({
              where: { itemId: { in: doomed.map((d) => d.itemId) }, quantity: { not: 0 } },
              select: { itemId: true, quantity: true },
            });
            if (bal) {
              throw new Error(`Stock still on ${doomed.find((d) => d.itemId === bal.itemId)?.itemCode} — clear stock before remap`);
            }
          }

          if (ff) {
            await tx.item.update({
              where: { itemId: ff.itemId },
              data: { previousStageItemId: null, deletedAt: new Date(), isActive: false, status: 'obsolete' },
            });
            removed++;
          }
          if (sf) {
            await tx.item.update({
              where: { itemId: sf.itemId },
              data: { previousStageItemId: null, deletedAt: new Date(), isActive: false, status: 'obsolete' },
            });
            removed++;
          }

          const made = await createStageItems(tx, items.createInTransaction.bind(items), {
            companyId,
            itemId: live.itemId,
            processCategoryCode: plan.process,
            actorId: admin.userId.toString(),
          });
          created += made.length;
          done++;
          if (made[0]) {
            console.log(`  ${live.itemCode} (${plan.oldCode}) → ${made[0].itemCode} [${plan.process}]  removed ${[sf?.itemCode, ff?.itemCode].filter(Boolean).join(', ') || '—'}`);
          }
        }
      }, TX);
      console.log(`      ${Math.min(i + CHUNK, limited.length)} / ${limited.length}`);
    }

    await prisma.userAudit.create({
      data: {
        companyId,
        performedBy: admin.userId,
        action: 'update',
        entityName: 'Item',
        entityId: companyId,
        newValue: {
          action: 'remap-ana-sf-to-process',
          remapped: done,
          processPartsCreated: created,
          softDeleted: removed,
          map: mapPath,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    log(`remapped ${done} · created ${created} process parts · soft-deleted ${removed} old SF/FF`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
