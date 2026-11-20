/**
 * Ensure ANA process / RM category stages match FE expectations:
 *   RM  → materialStage RM
 *   PLT, MCN, FAB, SHM, SPR (+ CMP if used as process) → materialStage SF
 * Creates SPR under Semi-Finished Store when missing.
 *
 *   node scripts/with-node-env.js development node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js \
 *     scripts/fix-ana-process-stages.ts --companyId 28
 * Add --dry-run to preview. Use `production` for LIVE (needs approval).
 */
import { PrismaClient } from '@prisma/client';

const PROCESS_CODES = ['PLT', 'MCN', 'FAB', 'SHM', 'SPR'] as const;
const PROCESS_META: Record<string, { name: string; description: string }> = {
  PLT: { name: 'Plates', description: 'Mounting, base, support and machined plates' },
  MCN: { name: 'Machined Components', description: 'Turned and milled parts' },
  FAB: { name: 'Fabricated Components', description: 'Welded structures, brackets, fabricated assemblies' },
  SHM: { name: 'Sheet-Metal Components', description: 'Bent, punched and formed sheet-metal parts' },
  SPR: { name: 'Springs', description: 'Compression and tension springs (process stage)' },
};

function parseArgs(argv: string[]) {
  const idx = argv.indexOf('--companyId');
  const raw = idx >= 0 ? argv[idx + 1] : undefined;
  if (!raw || !/^\d+$/.test(raw)) throw new Error('Usage: fix-ana-process-stages.ts --companyId <id> [--dry-run]');
  return { companyId: BigInt(raw), dryRun: argv.includes('--dry-run') };
}

async function main() {
  const { companyId, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findFirst({
      where: { companyId, deletedAt: null },
      select: { companyCode: true },
    });
    if (!company) throw new Error(`Company ${companyId} not found`);
    console.log(`Company ${companyId} (${company.companyCode})${dryRun ? ' — DRY RUN' : ''}`);

    const sfStore = await prisma.storeCategory.findFirst({
      where: { companyId, deletedAt: null, numberSeriesCode: 'SF' },
      select: { storeCategoryId: true, name: true },
    });
    if (!sfStore) throw new Error('Semi-Finished Store (SF) not found');

    const rm = await prisma.itemGroup.findFirst({
      where: { companyId, deletedAt: null, categoryCode: { equals: 'RM', mode: 'insensitive' } },
      select: { itemGroupId: true, name: true, materialStage: true },
    });
    if (rm && rm.materialStage !== 'RM') {
      console.log(`RM "${rm.name}": stage ${rm.materialStage ?? '(none)'} → RM`);
      if (!dryRun) {
        await prisma.itemGroup.update({
          where: { itemGroupId: rm.itemGroupId },
          data: { materialStage: 'RM', updatedAt: new Date() },
        });
      }
    } else if (rm) {
      console.log(`RM "${rm.name}": already stage RM`);
    } else {
      console.log('WARN  RM category not found');
    }

    for (const code of PROCESS_CODES) {
      let row = await prisma.itemGroup.findFirst({
        where: { companyId, deletedAt: null, categoryCode: { equals: code, mode: 'insensitive' } },
        select: {
          itemGroupId: true,
          name: true,
          materialStage: true,
          storeCategoryId: true,
        },
      });

      if (!row) {
        const meta = PROCESS_META[code];
        console.log(`create ${code} ${meta.name} under SF, stage SF`);
        if (!dryRun) {
          row = await prisma.itemGroup.create({
            data: {
              companyId,
              storeCategoryId: sfStore.storeCategoryId,
              name: meta.name,
              categoryCode: code,
              description: meta.description,
              materialStage: 'SF',
            },
            select: {
              itemGroupId: true,
              name: true,
              materialStage: true,
              storeCategoryId: true,
            },
          });

          const series = await prisma.numberSeriesConfig.findUnique({
            where: { companyId_documentType: { companyId, documentType: 'ITEM' } },
            select: { numberSeriesConfigId: true, lines: { select: { segmentRefId: true, segmentCode: true } } },
          });
          if (
            series &&
            !series.lines.some(
              (l) => l.segmentRefId === row!.itemGroupId || l.segmentCode.toUpperCase() === code
            )
          ) {
            await prisma.numberSeriesLine.create({
              data: {
                numberSeriesConfigId: series.numberSeriesConfigId,
                companyId,
                segmentRefId: row.itemGroupId,
                segmentCode: code,
                serialLength: 5,
              },
            });
            console.log(`  + number series line for ${code}`);
          }
        }
        continue;
      }

      if (row.materialStage !== 'SF') {
        console.log(`${code} "${row.name}": stage ${row.materialStage ?? '(none)'} → SF`);
        if (!dryRun) {
          await prisma.itemGroup.update({
            where: { itemGroupId: row.itemGroupId },
            data: { materialStage: 'SF', updatedAt: new Date() },
          });
        }
      } else {
        console.log(`${code} "${row.name}": already stage SF`);
      }
    }

    console.log(dryRun ? 'Dry-run only — no writes.' : 'Done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
