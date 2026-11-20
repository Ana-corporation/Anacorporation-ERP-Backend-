/**
 * Sample ITEM number series for one company (ANA layout): prefix ANA, source STORE,
 * separator NONE, serial length 5; store categories mapped by name to short segment codes.
 *
 * Idempotent: re-running changes nothing that already matches. Locked config / lines
 * (numbers already generated) are never changed. Missing categories are skipped with a warning.
 *
 * Run (DEV):
 *   node scripts/with-node-env.js development node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js \
 *     scripts/seed-number-series-ana.ts --companyId 28 --dry-run
 * Drop --dry-run to write. Use `production` instead of `development` for LIVE.
 */
import { Prisma, PrismaClient } from '@prisma/client';

const CONFIG = {
  prefix: 'ANA',
  segmentSource: 'STORE',
  separator: 'NONE',
  serialLengthDefault: 5,
  serialReset: 'NEVER',
} as const;

/** Category name (matched ignoring case, spaces, hyphens and a trailing "Store") → segment. */
const SEGMENTS: { name: string; code: string; serialLength: number }[] = [
  { name: 'Raw Material', code: 'RM', serialLength: 5 },
  { name: 'Spares', code: 'SP', serialLength: 5 },
  { name: 'Bought Out', code: 'BO', serialLength: 5 },
  { name: 'Electrical', code: 'EL', serialLength: 5 },
  { name: 'General', code: 'GN', serialLength: 5 },
  { name: 'Oil', code: 'OL', serialLength: 5 },
  { name: 'Finished Goods', code: 'FG', serialLength: 4 },
];

function parseArgs(argv: string[]): { companyId: bigint; dryRun: boolean } {
  const idx = argv.indexOf('--companyId');
  const raw = idx >= 0 ? argv[idx + 1] : undefined;
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error('Usage: seed-number-series-ana.ts --companyId <id> [--dry-run]');
  }
  return { companyId: BigInt(raw), dryRun: argv.includes('--dry-run') };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/store$/, '');
}

async function main() {
  const { companyId, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const plan: string[] = [];
  const warn = (msg: string) => plan.push(`WARN  ${msg}`);
  const act = (msg: string) => plan.push(`${dryRun ? 'PLAN' : 'DONE'}  ${msg}`);

  try {
    const company = await prisma.company.findFirst({
      where: { companyId, deletedAt: null },
      select: { companyId: true, companyCode: true },
    });
    if (!company) throw new Error(`Company ${companyId} not found`);
    console.log(`Company ${company.companyId} (${company.companyCode})${dryRun ? ' — DRY RUN' : ''}`);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let config = await tx.numberSeriesConfig.findUnique({
        where: { companyId_documentType: { companyId, documentType: 'ITEM' } },
      });

      if (!config) {
        act(`create ITEM series ${JSON.stringify(CONFIG)}`);
        if (!dryRun) config = await tx.numberSeriesConfig.create({ data: { companyId, documentType: 'ITEM', ...CONFIG } });
      } else {
        const changed = (Object.keys(CONFIG) as (keyof typeof CONFIG)[]).filter((k) => config![k] !== CONFIG[k]);
        if (changed.length === 0) {
          act('ITEM series already matches');
        } else if (config.isLocked) {
          warn(`ITEM series is locked; not changing ${changed.join(', ')}`);
        } else {
          act(`update ITEM series: ${changed.map((k) => `${k} ${config![k]} → ${CONFIG[k]}`).join(', ')}`);
          if (!dryRun) {
            config = await tx.numberSeriesConfig.update({
              where: { numberSeriesConfigId: config.numberSeriesConfigId },
              data: { ...CONFIG, updatedAt: new Date(), rowVersion: { increment: 1 } },
            });
          }
        }
      }

      const categories = await tx.storeCategory.findMany({
        where: { companyId, deletedAt: null },
        select: { storeCategoryId: true, name: true, numberSeriesCode: true },
      });
      const lines = config
        ? await tx.numberSeriesLine.findMany({ where: { numberSeriesConfigId: config.numberSeriesConfigId } })
        : [];

      for (const seg of SEGMENTS) {
        const category = categories.find((c) => normalizeName(c.name) === normalizeName(seg.name));
        if (!category) {
          warn(`no store category matching "${seg.name}" — skipped`);
          continue;
        }
        const label = `"${category.name}" → ${seg.code} (${seg.serialLength})`;

        const codeOwner = categories.find(
          (c) => c.numberSeriesCode === seg.code && c.storeCategoryId !== category.storeCategoryId,
        );
        const lineOwner = lines.find(
          (l) => l.segmentCode === seg.code && l.segmentRefId !== category.storeCategoryId,
        );
        if (codeOwner || lineOwner) {
          warn(`${label}: code ${seg.code} already used by another store — skipped`);
          continue;
        }

        const line = lines.find((l) => l.segmentRefId === category.storeCategoryId);
        if (line?.isLocked || (line && line.lastNumber > 0)) {
          if (line.segmentCode !== seg.code || line.serialLength !== seg.serialLength) {
            warn(`${label}: line is locked (${line.segmentCode}, ${line.serialLength}) — not changed`);
          } else {
            act(`${label}: already set (locked)`);
          }
        } else if (line && line.segmentCode === seg.code && line.serialLength === seg.serialLength) {
          act(`${label}: already set`);
        } else {
          act(`${label}: ${line ? 'update' : 'create'} line`);
          if (!dryRun && config) {
            await tx.numberSeriesLine.upsert({
              where: {
                numberSeriesConfigId_segmentRefId: {
                  numberSeriesConfigId: config.numberSeriesConfigId,
                  segmentRefId: category.storeCategoryId,
                },
              },
              create: {
                numberSeriesConfigId: config.numberSeriesConfigId,
                companyId,
                segmentRefId: category.storeCategoryId,
                segmentCode: seg.code,
                startFrom: 1,
                serialLength: seg.serialLength,
              },
              update: { segmentCode: seg.code, serialLength: seg.serialLength, updatedAt: new Date() },
            });
          }
        }

        const lockedCode = line && (line.isLocked || line.lastNumber > 0) ? line.segmentCode : seg.code;
        if (category.numberSeriesCode !== lockedCode) {
          act(`${label}: store category numberSeriesCode ${category.numberSeriesCode ?? '(none)'} → ${lockedCode}`);
          if (!dryRun) {
            await tx.storeCategory.update({
              where: { storeCategoryId: category.storeCategoryId },
              data: { numberSeriesCode: lockedCode, updatedAt: new Date() },
            });
          }
        }
      }
    });

    plan.forEach((line) => console.log(line));
    console.log(dryRun ? 'Dry run — nothing written.' : 'Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
