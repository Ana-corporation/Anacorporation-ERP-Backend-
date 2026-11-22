/**
 * Machine master setup for ANA (docs/MACHINE-MASTER-BACKEND-PLAN.txt, step M3):
 *   1. Category "Machines" (code MAC) in the Finished Goods store (FF) + its ITEM series line
 *   2. machine_settings → MAC category, NOS unit
 *   3. Base machine BS500, linked to the existing machine item (ANAASSY00012, old BS5000000000A1);
 *      when that item does not exist (DEV) a new item is created in the MAC category
 *
 * Idempotent: existing category / line / settings / machine are kept.
 *
 * Run (DEV):
 *   node scripts/with-node-env.js development node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js --transpile-only \
 *     scripts/seed-ana-machines.ts --companyId 28 --dry-run
 * Drop --dry-run to write. Use `production` instead of `development` for LIVE.
 */
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { ItemsRepository } from '@/modules/inventory/item-master/items.repository';
import { ItemsService } from '@/modules/inventory/item-master/items.service';
import { BomLinesService } from '@/modules/manufacturing/bom/bom-lines.service';
import { BomViewService } from '@/modules/manufacturing/bom/bom-view.service';
import { BomsRepository } from '@/modules/manufacturing/bom/boms.repository';
import { BomsService } from '@/modules/manufacturing/bom/boms.service';
import { MachinesService } from '@/modules/manufacturing/machines/machines.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { IdempotencyService } from '@/modules/shared/idempotency/idempotency.service';
import { DocumentNumberService } from '@/modules/shared/number-series/document-number.service';
import { PartNumberGeneratorService } from '@/modules/shared/number-series/part-number-generator.service';

const CATEGORY = { code: 'MAC', name: 'Machines', storeCode: 'FF', description: 'Finished machines (Machine master)' };
const UOM_CODE = 'NOS';
const ADMIN_EMAIL = 'jegan@anamachinery.com';
const MACHINE = { machineCode: 'BS500', name: 'BS500 MACHINE', series: 'BS', model: '500' };
const MACHINE_ITEM = { itemCode: 'ANAASSY00012', oldCode: 'BS5000000000A1' };

function parseArgs(argv: string[]) {
  const idx = argv.indexOf('--companyId');
  const raw = idx >= 0 ? argv[idx + 1] : undefined;
  if (!raw || !/^\d+$/.test(raw)) throw new Error('Usage: seed-ana-machines.ts --companyId <id> [--dry-run]');
  return { companyId: BigInt(raw), dryRun: argv.includes('--dry-run') };
}

async function main() {
  const { companyId, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  const act = (msg: string) => console.log(`${dryRun ? 'PLAN' : 'DONE'}  ${msg}`);
  const keep = (msg: string) => console.log(`KEEP  ${msg}`);

  try {
    const company = await prisma.company.findFirst({ where: { companyId, deletedAt: null }, select: { companyCode: true } });
    if (!company) throw new Error(`Company ${companyId} not found`);
    console.log(`Company ${companyId} (${company.companyCode})${dryRun ? ' — DRY RUN' : ''}`);

    const admin = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL }, select: { userId: true } });
    if (!admin) throw new Error(`User ${ADMIN_EMAIL} not found`);

    // 1) Category + series line
    const store = await prisma.storeCategory.findFirst({
      where: { companyId, deletedAt: null, numberSeriesCode: CATEGORY.storeCode },
      select: { storeCategoryId: true, name: true },
    });
    if (!store) throw new Error(`Store with part-number code ${CATEGORY.storeCode} not found`);

    let group = await prisma.itemGroup.findFirst({
      where: { companyId, deletedAt: null, categoryCode: CATEGORY.code },
      select: { itemGroupId: true, name: true },
    });
    if (group) {
      keep(`category ${CATEGORY.code} "${group.name}"`);
    } else {
      act(`create category ${CATEGORY.code} "${CATEGORY.name}" in store "${store.name}"`);
      if (!dryRun) {
        group = await prisma.itemGroup.create({
          data: { companyId, storeCategoryId: store.storeCategoryId, name: CATEGORY.name, categoryCode: CATEGORY.code, description: CATEGORY.description, createdBy: admin.userId },
          select: { itemGroupId: true, name: true },
        });
      }
    }

    const config = await prisma.numberSeriesConfig.findUnique({
      where: { companyId_documentType: { companyId, documentType: 'ITEM' } },
      include: { lines: true },
    });
    if (!config) throw new Error('No ITEM number series for this company');
    if (config.segmentSource !== 'ITEM_GROUP') throw new Error(`ITEM series segment source is ${config.segmentSource}, expected ITEM_GROUP`);
    const line = group ? config.lines.find((l) => l.segmentRefId === group!.itemGroupId) : undefined;
    if (line) {
      keep(`series line ${line.segmentCode}`);
    } else {
      act(`series line ${CATEGORY.code}, ${config.serialLengthDefault} digits`);
      if (!dryRun && group) {
        await prisma.numberSeriesLine.create({
          data: { numberSeriesConfigId: config.numberSeriesConfigId, companyId, segmentRefId: group.itemGroupId, segmentCode: CATEGORY.code, serialLength: config.serialLengthDefault },
        });
      }
    }

    // 2) Settings
    const uom = await prisma.uom.findFirst({ where: { companyId, code: UOM_CODE, deletedAt: null, isActive: true }, select: { uomId: true } });
    if (!uom) throw new Error(`Unit ${UOM_CODE} not found`);
    const settings = await prisma.machineSettings.findUnique({ where: { companyId } });

    const audit = new AuditService(prisma);
    const generator = new PartNumberGeneratorService();
    const items = new ItemsService(
      new ItemsRepository(prisma),
      audit,
      {} as DataAccessPoliciesService,
      {} as StorageService,
      { persistCustomFields: async () => undefined } as unknown as CustomFieldsValuesService,
      generator,
      { loadFieldOverrides: async () => ({ visibility: new Map(), registration: new Map(), order: new Map() }) } as never,
    );
    const bomRepo = new BomsRepository(prisma);
    const bomView = new BomViewService(bomRepo, audit);
    const boms = new BomsService(bomRepo, new BomLinesService(bomRepo, bomView), bomView, new DocumentNumberService(prisma), new IdempotencyService(), audit);
    const machines = new MachinesService(prisma, items, boms, new IdempotencyService(), audit);
    const user = { sub: admin.userId.toString(), role: 'super_admin', permissions: [], modules: [], companyId: companyId.toString(), subscriptionStatus: 'active' } as unknown as AuthenticatedUser;

    if (settings) {
      keep(`machine settings (category ${settings.itemGroupId}, unit ${settings.uomId})`);
    } else {
      act(`machine settings → ${CATEGORY.code}, ${UOM_CODE}`);
      if (!dryRun && group) await machines.saveSettings(companyId, { itemGroupId: group.itemGroupId.toString(), uomId: uom.uomId.toString() } as never, user);
    }

    // 3) Base machine BS500
    const existing = await prisma.machine.findFirst({ where: { companyId, machineCode: MACHINE.machineCode, deletedAt: null }, select: { machineId: true } });
    if (existing) {
      keep(`machine ${MACHINE.machineCode} (id ${existing.machineId})`);
      return;
    }
    const item = await prisma.item.findFirst({
      where: { companyId, deletedAt: null, OR: [{ itemCode: MACHINE_ITEM.itemCode }, { oldCode: MACHINE_ITEM.oldCode }] },
      select: { itemId: true, itemCode: true, machine: { select: { machineCode: true } } },
    });
    if (item?.machine) throw new Error(`Item ${item.itemCode} is already linked to machine ${item.machine.machineCode}`);
    act(`machine ${MACHINE.machineCode} "${MACHINE.name}" → ${item ? `link item ${item.itemCode}` : `new item in ${CATEGORY.code}`}`);
    if (!dryRun) {
      const created = await machines.create(companyId, { ...MACHINE, linkItemId: item?.itemId.toString() } as never, user);
      console.log(`      machine id ${String((created as { machineId?: unknown }).machineId)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
