/**
 * Imports a store's Material Category Master sheet (Sl. No. | Part Name | Category Code |
 * Material Category | Material Type) for one company:
 *   1. categories (Item Groups) with their code under the target store — an existing category
 *      with the same code is moved / renamed only while it has no items or sub-groups;
 *   2. one Number Series line per category (category-based series);
 *   3. one item per part (same name in the same category is skipped), with the part number
 *      generated from the category (ANAELC00001 …) in ONE transaction — any failure saves nothing.
 *
 * Idempotent (re-running creates only what is missing). Dry run prints the plan and the part
 * numbers that would be used, without using them.
 *
 *   node scripts/with-node-env.js development node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js \
 *     scripts/import-ana-material-master.ts --companyId 28 --store ES --uom NOS \
 *     --file "C:/Users/swent/Downloads/Material_Category_Master-Electrical - 23.10.2026.xlsx" --dry-run
 */
import * as ExcelJS from 'exceljs';
import { Prisma, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { CreateItemDto } from '@/modules/inventory/item-master/dto/item.dto';
import { ItemsRepository } from '@/modules/inventory/item-master/items.repository';
import { ItemsService } from '@/modules/inventory/item-master/items.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { FormConfigurationService } from '@/modules/shared/form-configuration/form-configuration.service';
import { formatPartNumber } from '@/modules/shared/number-series/number-series.util';
import { PartNumberGeneratorService } from '@/modules/shared/number-series/part-number-generator.service';

type SheetRow = { partName: string; code: string; category: string; type: string };

function arg(argv: string[], flag: string) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]) {
  const companyId = arg(argv, '--companyId');
  const file = arg(argv, '--file');
  if (!companyId || !/^\d+$/.test(companyId) || !file) {
    throw new Error('Usage: import-ana-material-master.ts --companyId <id> --file <xlsx> [--store ES] [--uom NOS] [--dry-run]');
  }
  return {
    companyId: BigInt(companyId),
    file,
    storeCode: (arg(argv, '--store') ?? 'ES').toUpperCase(),
    uomCode: (arg(argv, '--uom') ?? 'NOS').toUpperCase(),
    dryRun: argv.includes('--dry-run'),
  };
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('text' in v && v.text) return String(v.text);
    if ('result' in v && v.result != null) return String(v.result);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
  }
  return String(v);
};

async function readSheet(file: string): Promise<SheetRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).map((v) => cellText(v).trim().toLowerCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Column "${name}" not found in ${file}`);
    return i;
  };
  const [cName, cCode, cCat, cType] = [col('part name'), col('category code'), col('material category'), col('material type')];
  const rows: SheetRow[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const v = row.values as ExcelJS.CellValue[];
    const partName = cellText(v[cName]).trim().replace(/\s+/g, ' ');
    const code = cellText(v[cCode]).trim().toUpperCase();
    if (!partName || !code) return;
    rows.push({ partName, code, category: cellText(v[cCat]).trim(), type: cellText(v[cType]).trim() });
  });
  return rows;
}

async function main() {
  const { companyId, file, storeCode, uomCode, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const generator = new PartNumberGeneratorService();
  const items = new ItemsService(
    new ItemsRepository(prisma),
    audit,
    {} as DataAccessPoliciesService,
    {} as StorageService,
    {} as CustomFieldsValuesService,
    generator,
    {} as FormConfigurationService,
  );
  const say = (msg: string) => console.log(`${dryRun ? 'PLAN' : 'DONE'}  ${msg}`);
  const warn = (msg: string) => console.log(`WARN  ${msg}`);

  try {
    const company = await prisma.company.findFirst({ where: { companyId, deletedAt: null }, select: { companyCode: true } });
    if (!company) throw new Error(`Company ${companyId} not found`);
    const sheetRows = await readSheet(file);
    console.log(`Company ${companyId} (${company.companyCode})${dryRun ? ' — DRY RUN' : ''} — ${sheetRows.length} rows from ${file}`);

    const store = await prisma.storeCategory.findFirst({
      where: { companyId, deletedAt: null, numberSeriesCode: storeCode },
      select: { storeCategoryId: true, name: true },
    });
    if (!store) throw new Error(`Store with code ${storeCode} not found`);
    const uom = await prisma.uom.findFirst({ where: { companyId, deletedAt: null, code: uomCode }, select: { uomId: true, code: true } });
    if (!uom) throw new Error(`UOM ${uomCode} not found`);
    const series = await prisma.numberSeriesConfig.findUnique({
      where: { companyId_documentType: { companyId, documentType: 'ITEM' } },
      include: { lines: true },
    });
    if (!series || series.segmentSource !== 'ITEM_GROUP' || !series.isActive) {
      throw new Error('The ITEM number series must be active and category-based (segment source ITEM_GROUP)');
    }

    // Distinct categories of the sheet (first name / type seen wins).
    const sheetCategories = new Map<string, { name: string; type: string; rows: SheetRow[] }>();
    for (const r of sheetRows) {
      const c = sheetCategories.get(r.code) ?? { name: r.category, type: r.type, rows: [] };
      c.rows.push(r);
      sheetCategories.set(r.code, c);
    }

    await prisma.$transaction(
      async (client) => {
        const tx = client as unknown as Prisma.TransactionClient;

        // 1) Categories
        const categoryId = new Map<string, bigint>();
        for (const [code, c] of sheetCategories) {
          const existing = await tx.itemGroup.findFirst({
            where: { companyId, categoryCode: code, deletedAt: null },
            select: {
              itemGroupId: true,
              name: true,
              storeCategoryId: true,
              description: true,
              _count: { select: { items: { where: { deletedAt: null } }, children: { where: { deletedAt: null } } } },
            },
          });
          if (!existing) {
            say(`create category ${code} "${c.name}" in ${store.name}`);
            if (!dryRun) {
              const created = await tx.itemGroup.create({
                data: { companyId, storeCategoryId: store.storeCategoryId, name: c.name, categoryCode: code, description: c.type },
              });
              categoryId.set(code, created.itemGroupId);
            }
            continue;
          }
          categoryId.set(code, existing.itemGroupId);
          const differs =
            existing.storeCategoryId !== store.storeCategoryId || existing.name !== c.name || existing.description !== c.type;
          if (!differs) continue;
          if (existing._count.items > 0 || existing._count.children > 0) {
            warn(`category ${code} "${existing.name}" has items / sub-groups — kept as it is`);
            continue;
          }
          say(`category ${code}: "${existing.name}" → "${c.name}", store → ${store.name}`);
          if (!dryRun) {
            await tx.itemGroup.update({
              where: { itemGroupId: existing.itemGroupId },
              data: { name: c.name, storeCategoryId: store.storeCategoryId, description: c.type, updatedAt: new Date() },
            });
          }
        }

        // 2) Series lines
        for (const [code] of sheetCategories) {
          const id = categoryId.get(code);
          if (id && series.lines.some((l) => l.segmentRefId === id)) continue;
          say(`series line ${code}, ${series.serialLengthDefault} digits`);
          if (!dryRun && id) {
            await tx.numberSeriesLine.create({
              data: { numberSeriesConfigId: series.numberSeriesConfigId, companyId, segmentRefId: id, segmentCode: code, serialLength: series.serialLengthDefault },
            });
          }
        }

        // 3) Items (skip names already in the category; skip duplicates inside the sheet)
        const toCreate: Array<{ code: string; dto: CreateItemDto }> = [];
        for (const [code, c] of sheetCategories) {
          const id = categoryId.get(code);
          const existingNames = new Set(
            id
              ? (
                  await tx.item.findMany({ where: { companyId, itemGroupId: id, deletedAt: null }, select: { description: true } })
                ).map((i) => i.description.trim().toLowerCase())
              : [],
          );
          let skipped = 0;
          for (const r of c.rows) {
            const key = r.partName.toLowerCase();
            if (existingNames.has(key)) {
              skipped++;
              continue;
            }
            existingNames.add(key);
            toCreate.push({
              code,
              dto: {
                description: r.partName.slice(0, 255),
                storeCategoryId: store.storeCategoryId.toString(),
                itemGroupId: id?.toString(),
                inventoryUomId: uom.uomId.toString(),
                status: 'active',
                isInventoryItem: true,
                inventory: { uomName: uom.code },
              } as CreateItemDto,
            });
          }
          const count = toCreate.filter((t) => t.code === code).length;
          const line = series.lines.find((l) => l.segmentRefId === id);
          const first = Math.max(line?.lastNumber ?? 0, (line?.startFrom ?? 1) - 1) + 1;
          const fmt = (n: number) =>
            formatPartNumber({ prefix: series.prefix, separator: series.separator, segmentCode: code, serial: n, serialLength: line?.serialLength ?? series.serialLengthDefault });
          if (count) say(`${code}: ${count} item(s) ${fmt(first)} … ${fmt(first + count - 1)}${skipped ? `, ${skipped} already there` : ''}`);
          else if (skipped) say(`${code}: all ${skipped} item(s) already there`);
        }

        if (dryRun || toCreate.length === 0) return;
        const created = await items.createManyInTransaction(tx, companyId.toString(), toCreate.map((t) => t.dto), '');
        await tx.userAudit.createMany({
          data: created.map((c) => ({
            companyId,
            action: UserAuditAction.create,
            entityName: 'Item',
            entityId: c.itemId,
            newValue: { itemCode: c.itemCode, description: c.description, source: 'material-master-import' } as Prisma.InputJsonValue,
          })),
        });
        say(`created ${created.length} items (${created[0]?.itemCode} …)`);
      },
      { timeout: 600_000, maxWait: 30_000 },
    );

    console.log(dryRun ? 'Dry run — nothing written.' : 'Material master imported.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
