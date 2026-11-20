/**
 * Sample data for ANA's category-based part numbers (Standard Category Master, sheet 1):
 *   1. Store part-number codes → BO, ES, FF, GS, OS, RM, SF (adds "Semi-Finished Store" if missing)
 *   2. Categories (Item Groups) with category codes, under their store (sheet 1 + LBL, RMT, PNT)
 *   3. ITEM number series → prefix ANA, segment source Category, no separator, 5 digits,
 *      one counter line per category
 *
 * Idempotent; never changes a code that part numbers already use; stops if the series is
 * already locked to another segment source (run the test-data cleanup first).
 *
 * Run (DEV):
 *   node scripts/with-node-env.js development node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js \
 *     scripts/seed-ana-categories.ts --companyId 28 --dry-run
 * Drop --dry-run to write. Use `production` instead of `development` for LIVE.
 */
import { Prisma, PrismaClient } from '@prisma/client';

/** Old part-number store code → new one (from the category master). */
const STORE_CODE_CHANGES: Record<string, string> = { RM: 'RM', BO: 'BO', EL: 'ES', GN: 'GS', OL: 'OS', FG: 'FF' };
/** Stores without a code are matched by name (lowercase, letters only, "store" dropped). */
const STORE_CODE_BY_NAME: Record<string, string> = {
  rawmaterial: 'RM',
  rm: 'RM',
  boughtout: 'BO',
  electrical: 'ES',
  general: 'GS',
  oil: 'OS',
  finishedgoods: 'FF',
  fullyfinished: 'FF',
  semifinished: 'SF',
};
const storeNameKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '').replace(/store$/, '');

const NEW_STORES = [{ code: 'SF', name: 'Semi-Finished Store', codePrefix: 'SFS' }];

const SERIES = { prefix: 'ANA', segmentSource: 'ITEM_GROUP', separator: 'NONE', serialLengthDefault: 5, serialReset: 'NEVER' } as const;

/** code | category | store code | examples / scope */
const CATEGORIES: Array<[string, string, string, string]> = [
  ['PLY', 'Pulleys', 'BO', 'Timing pulleys, HTD pulleys'],
  ['BLT', 'Belts', 'BO', 'Timing belts, drive belts'],
  ['BRG', 'Bearings', 'BO', 'Ball bearings, roller bearings'],
  ['MTR', 'Motors', 'BO', 'Electric motors, geared motors'],
  ['CMP', 'General Components', 'BO', 'Components not assigned to a specific category'],
  ['FST', 'Fasteners', 'BO', 'Nuts, bolts, screws, washers, studs'],
  ['TLS', 'Tooling Sleeves & Accessories', 'ES', 'Bought-Out Tooling Component'],
  ['PIN', 'Pins', 'BO', 'Dowel pins, locating pins'],
  ['RIN', 'Retaining Rings', 'BO', 'Circlips, retaining rings'],
  ['ROL', 'Rollers', 'BO', 'Conveyor, guide and rubber rollers'],
  ['ORG', 'O-Rings', 'BO', 'O-rings and rubber sealing rings'],
  ['ROP', 'Ropes', 'BO', 'Nylon, polyester and steel wire ropes'],
  ['MEC', 'General Mechanical / Machine Components', 'ES', 'Bought-Out Mechanical Component'],
  ['LBL', 'Machine Labels & Stickers', 'ES', 'Bought-Out Identification / Printing Material'],
  ['RMT', 'Rubber Mats', 'BO', 'Rubber mats'],
  ['ELT', 'Electrical Components', 'ES', 'Sensors, switches, electrical components'],
  ['EYK', 'Electrical Cabinet Keys', 'ES', 'Panel keys and electrical cabinet keys'],
  ['ASSY', 'Assemblies', 'FF', 'Subassemblies and finished assemblies'],
  ['PNL', 'Panel Hardware & Ventilation Accessories', 'ES', 'Bought-Out Panel / Mechanical Component'],
  ['PKG', 'Packing Materials', 'GS', 'Corrugated boxes, bubble wrap, stretch film, foam sheets, packing tape'],
  ['SEA', 'Sealing Materials', 'GS', 'Gland packing, PTFE packing, rubber packing'],
  ['LUB', 'Lubricants and Oils', 'OS', 'Lubricating oil, hydraulic oil, gear oil, grease, compressor oil, cutting oil'],
  ['PNT', 'Paints', 'OS', 'Paints'],
  ['RM', 'Raw Materials', 'RM', 'Steel, aluminium, bars, sheets'],
  ['MCN', 'Machined Components', 'SF', 'Turned and milled parts'],
  ['FAB', 'Fabricated Components', 'SF', 'Welded structures, brackets, fabricated assemblies'],
  ['PLT', 'Plates', 'SF', 'Mounting, base, support and machined plates'],
  ['SHM', 'Sheet-Metal Components', 'SF', 'Bent, punched and formed sheet-metal parts'],
  ['SPR', 'Springs', 'SF', 'Compression and tension springs (process stage)'],
];

function parseArgs(argv: string[]) {
  const idx = argv.indexOf('--companyId');
  const raw = idx >= 0 ? argv[idx + 1] : undefined;
  if (!raw || !/^\d+$/.test(raw)) throw new Error('Usage: seed-ana-categories.ts --companyId <id> [--dry-run]');
  return { companyId: BigInt(raw), dryRun: argv.includes('--dry-run') };
}

async function main() {
  const { companyId, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const plan: string[] = [];
  const act = (msg: string) => plan.push(`${dryRun ? 'PLAN' : 'DONE'}  ${msg}`);
  const warn = (msg: string) => plan.push(`WARN  ${msg}`);

  try {
    const company = await prisma.company.findFirst({ where: { companyId, deletedAt: null }, select: { companyCode: true } });
    if (!company) throw new Error(`Company ${companyId} not found`);
    console.log(`Company ${companyId} (${company.companyCode})${dryRun ? ' — DRY RUN' : ''}`);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1) Store codes
        const stores = await tx.storeCategory.findMany({
          where: { companyId, deletedAt: null },
          select: { storeCategoryId: true, name: true, codePrefix: true, numberSeriesCode: true, sortOrder: true },
        });
        const storeByCode = new Map<string, bigint>();
        const nextCodeOf = (s: (typeof stores)[number]) =>
          s.numberSeriesCode ? STORE_CODE_CHANGES[s.numberSeriesCode] ?? s.numberSeriesCode : STORE_CODE_BY_NAME[storeNameKey(s.name)];
        const changes = stores.flatMap((s) => {
          const next = nextCodeOf(s);
          return next && next !== s.numberSeriesCode && !storeByCode.has(next) ? [{ s, next }] : [];
        });
        for (const s of stores) {
          const next = nextCodeOf(s);
          if (next && !storeByCode.has(next)) storeByCode.set(next, s.storeCategoryId);
        }
        for (const { s, next } of changes) {
          act(`store "${s.name}": code ${s.numberSeriesCode ?? '(none)'} → ${next}`);
          if (!dryRun) await tx.storeCategory.update({ where: { storeCategoryId: s.storeCategoryId }, data: { numberSeriesCode: null } });
        }
        if (!dryRun) {
          for (const { s, next } of changes) {
            if (storeByCode.get(next) !== s.storeCategoryId) continue;
            await tx.storeCategory.update({ where: { storeCategoryId: s.storeCategoryId }, data: { numberSeriesCode: next, updatedAt: new Date() } });
          }
        }
        let sortOrder = Math.max(0, ...stores.map((s) => s.sortOrder));
        for (const ns of NEW_STORES) {
          if (storeByCode.has(ns.code)) continue;
          const byName = stores.find((s) => s.name.toLowerCase() === ns.name.toLowerCase());
          if (byName) {
            act(`store "${byName.name}": code → ${ns.code}`);
            if (!dryRun) await tx.storeCategory.update({ where: { storeCategoryId: byName.storeCategoryId }, data: { numberSeriesCode: ns.code } });
            storeByCode.set(ns.code, byName.storeCategoryId);
            continue;
          }
          act(`create store "${ns.name}" (${ns.code}, location prefix ${ns.codePrefix})`);
          if (!dryRun) {
            const created = await tx.storeCategory.create({
              data: { companyId, name: ns.name, codePrefix: ns.codePrefix, numberSeriesCode: ns.code, sortOrder: ++sortOrder },
            });
            storeByCode.set(ns.code, created.storeCategoryId);
          } else {
            storeByCode.set(ns.code, -1n);
          }
        }

        // 2) Categories
        const groups = await tx.itemGroup.findMany({
          where: { companyId, deletedAt: null },
          select: {
            itemGroupId: true,
            name: true,
            storeCategoryId: true,
            parentId: true,
            categoryCode: true,
            description: true,
            materialStage: true,
          },
        });
        /** RM = raw; SF-store process segments = Stage SF (many allowed). */
        const stageFor = (code: string, storeCode: string): 'RM' | 'SF' | null => {
          if (code === 'RM') return 'RM';
          if (storeCode === 'SF') return 'SF';
          return null;
        };
        const categoryIds: Array<{ id: bigint; code: string; name: string }> = [];
        for (const [code, name, storeCode, examples] of CATEGORIES) {
          const storeId = storeByCode.get(storeCode);
          if (!storeId) {
            warn(`${code} ${name}: store ${storeCode} not found — skipped`);
            continue;
          }
          const stage = stageFor(code, storeCode);
          const existing =
            groups.find((g) => g.categoryCode === code) ??
            groups.find((g) => g.storeCategoryId === storeId && !g.parentId && g.name.toLowerCase() === name.toLowerCase());
          if (existing) {
            if (existing.categoryCode && existing.categoryCode !== code) {
              warn(`${name}: already has code ${existing.categoryCode} — kept`);
              categoryIds.push({ id: existing.itemGroupId, code: existing.categoryCode, name });
              continue;
            }
            const needCode = existing.categoryCode !== code || existing.description !== examples;
            const needStage = stage && existing.materialStage !== stage;
            if (needCode || needStage) {
              act(
                `category ${code} ${name}: update${needCode ? ' code/description' : ''}${needStage ? ` stage→${stage}` : ''}`
              );
              if (!dryRun) {
                await tx.itemGroup.update({
                  where: { itemGroupId: existing.itemGroupId },
                  data: {
                    categoryCode: code,
                    description: examples,
                    ...(needStage ? { materialStage: stage } : {}),
                    updatedAt: new Date(),
                  },
                });
              }
            }
            categoryIds.push({ id: existing.itemGroupId, code, name });
            continue;
          }
          act(`create category ${code} ${name} (${storeCode}${stage ? `, stage ${stage}` : ''})`);
          if (!dryRun && storeId > 0n) {
            const created = await tx.itemGroup.create({
              data: {
                companyId,
                storeCategoryId: storeId,
                name,
                categoryCode: code,
                description: examples,
                ...(stage ? { materialStage: stage } : {}),
              },
            });
            categoryIds.push({ id: created.itemGroupId, code, name });
          }
        }

        // 3) Number series
        const config = await tx.numberSeriesConfig.findUnique({
          where: { companyId_documentType: { companyId, documentType: 'ITEM' } },
          include: { lines: true },
        });
        if (config?.isLocked && config.segmentSource !== SERIES.segmentSource) {
          warn(`ITEM series is locked to ${config.segmentSource} (numbers already generated) — run the test-data cleanup first; series not changed`);
          return;
        }
        let configId: bigint;
        if (!config) {
          act(`create ITEM series ${JSON.stringify(SERIES)}`);
          if (dryRun) return;
          configId = (await tx.numberSeriesConfig.create({ data: { companyId, documentType: 'ITEM', ...SERIES } })).numberSeriesConfigId;
        } else {
          configId = config.numberSeriesConfigId;
          const changed = (Object.keys(SERIES) as (keyof typeof SERIES)[]).filter((k) => config[k] !== SERIES[k]);
          if (changed.length) {
            if (config.isLocked) {
              warn(`ITEM series is locked; not changing ${changed.join(', ')}`);
            } else {
              act(`ITEM series: ${changed.map((k) => `${k} ${config[k]} → ${SERIES[k]}`).join(', ')}`);
              if (!dryRun) {
                await tx.numberSeriesConfig.update({
                  where: { numberSeriesConfigId: configId },
                  data: { ...SERIES, updatedAt: new Date(), rowVersion: { increment: 1 } },
                });
              }
            }
          }
          if (config.segmentSource !== SERIES.segmentSource && config.lines.length) {
            act(`remove ${config.lines.length} old ${config.segmentSource} line(s) (unused)`);
            if (!dryRun) await tx.numberSeriesLine.deleteMany({ where: { numberSeriesConfigId: configId } });
          }
        }
        const keep = config && config.segmentSource === SERIES.segmentSource ? config.lines : [];
        for (const c of categoryIds) {
          if (keep.some((l) => l.segmentRefId === c.id)) continue;
          act(`series line ${c.code} (${c.name}), 5 digits`);
          if (!dryRun) {
            await tx.numberSeriesLine.create({
              data: { numberSeriesConfigId: configId, companyId, segmentRefId: c.id, segmentCode: c.code, serialLength: SERIES.serialLengthDefault },
            });
          }
        }
        if (dryRun && categoryIds.length < CATEGORIES.length) {
          act(`series lines for ${CATEGORIES.length - categoryIds.length} new categor(ies), 5 digits`);
        }
      },
      { timeout: 120_000, maxWait: 30_000 },
    );

    plan.forEach((line) => console.log(line));
    console.log(dryRun ? 'Dry run — nothing written.' : 'ANA categories seeded.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
