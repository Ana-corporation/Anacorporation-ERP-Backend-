/**
 * DEV only (Erp_test_db): create separate servo materials from the brand-wise
 * electrical Excel (yellow/theme-9 rows + full servo component block).
 *
 *   node scripts/with-node-env.js development node scripts/create-ana-servo-split-items-local.js
 *   node scripts/with-node-env.js development node scripts/create-ana-servo-split-items-local.js --dry-run
 */
require('./apply-gcp-sql-env');
const path = require('path');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { PartNumberGeneratorService } = require('../dist/modules/shared/number-series/part-number-generator.service');

const COMPANY_ID = 28n;
const FILE = 'c:/Users/swent/Downloads/brand wise master list of ele.xlsx';
const DRY = process.argv.includes('--dry-run');

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v !== 'object') return String(v).trim();
  if (v.richText) return v.richText.map((t) => t.text).join('').trim();
  if (v.text) return String(v.text).trim();
  if (v.result !== undefined) return String(v.result).trim();
  return String(v).trim();
}

function isHighlight(cell) {
  const f = cell?.fill;
  return f?.type === 'pattern' && f.fgColor && f.fgColor.theme === 9;
}

function isServoComponent(name) {
  return /SERVO DRIVE|SERVO MOTOR|POWER CABLE|ENCODER CABLE|CONNECTING PIN/i.test(name || '');
}

async function readPartsFromExcel() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];
  const parts = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = [];
    let highlighted = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 16) return;
      values[col - 1] = cellText(cell);
      if (isHighlight(cell)) highlighted = true;
    });
    const partName = values[1] || '';
    // Yellow (theme 9) only — 15 separate materials that replace SERVO SET lines
    if (!partName || !highlighted || !isServoComponent(partName)) return;
    parts.push({
      rowNumber,
      highlighted,
      partName,
      uom: (values[2] || 'NOS').toUpperCase(),
      categoryCode: (values[3] || '').toUpperCase(),
      brand1: values[6] || '',
      model1: values[7] || '',
      brand2: values[9] || '',
      model2: values[10] || '',
      brand3: values[12] || '',
      model3: values[13] || '',
    });
  });
  // Dedupe by part name (case-insensitive)
  const seen = new Set();
  const unique = [];
  for (const p of parts) {
    const key = p.partName.toUpperCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique;
}

async function main() {
  if (process.env.APP_DB_LABEL === 'PROD' || process.env.NODE_ENV === 'production') {
    throw new Error('Refusing PROD/live. Use development only.');
  }
  const prisma = new PrismaClient();
  const schema = (await prisma.$queryRawUnsafe(`select current_schema() as s`))[0].s;
  if (schema !== 'Erp_test_db') throw new Error(`Expected Erp_test_db, got ${schema}`);

  const parts = await readPartsFromExcel();
  const elc = await prisma.itemGroup.findFirst({
    where: { companyId: COMPANY_ID, categoryCode: 'ELC', deletedAt: null },
  });
  const mot = await prisma.itemGroup.findFirst({
    where: { companyId: COMPANY_ID, categoryCode: 'MOT', deletedAt: null },
  });
  const nos = await prisma.uom.findFirst({
    where: { companyId: COMPANY_ID, code: 'NOS', deletedAt: null, isActive: true },
  });
  if (!elc || !mot || !nos) throw new Error('ELC/MOT category or NOS UoM missing');

  const generator = new PartNumberGeneratorService();
  const created = [];
  const skipped = [];

  for (const part of parts) {
    const categoryCode = part.categoryCode === 'MOT' ? 'MOT' : 'ELC';
    const group = categoryCode === 'MOT' ? mot : elc;
    const existing = await prisma.item.findFirst({
      where: {
        companyId: COMPANY_ID,
        deletedAt: null,
        description: { equals: part.partName, mode: 'insensitive' },
        storeCategoryId: group.storeCategoryId,
      },
      select: { itemId: true, itemCode: true, description: true },
    });
    if (existing) {
      skipped.push({ reason: 'exists', itemCode: existing.itemCode, description: existing.description });
      continue;
    }

    const brandName = part.brand1 || part.brand2 || part.brand3 || null;
    const models = [part.model1, part.model2, part.model3].filter(Boolean);
    const additionalIdentifier = models.length ? models.join(' / ').slice(0, 100) : null;
    const remarks = [
      brandName ? `Brand: ${brandName}` : null,
      models.length ? `Model: ${models.join(' | ')}` : null,
      part.brand2 ? `Alt brand: ${part.brand2}${part.model2 ? ' ' + part.model2 : ''}` : null,
      part.brand3 ? `Alt brand: ${part.brand3}${part.model3 ? ' ' + part.model3 : ''}` : null,
    ]
      .filter(Boolean)
      .join('; ')
      .slice(0, 500);

    if (DRY) {
      created.push({ dryRun: true, description: part.partName, categoryCode, brandName, additionalIdentifier });
      continue;
    }

    const item = await prisma.$transaction(async (tx) => {
      const itemCode = await generator.generatePartNumber(tx, COMPANY_ID, {
        storeCategoryId: group.storeCategoryId,
        itemGroupId: group.itemGroupId,
      });
      return tx.item.create({
        data: {
          companyId: COMPANY_ID,
          itemCode,
          description: part.partName,
          storeCategoryId: group.storeCategoryId,
          itemGroupId: group.itemGroupId,
          inventoryUomId: nos.uomId,
          brandName,
          additionalIdentifier,
          remarks: remarks || null,
          isInventoryItem: true,
          isPurchaseItem: true,
          isSalesItem: false,
          isActive: true,
          status: 'active',
          manageBy: 'none',
          inventoryJson: { uomName: 'NOS' },
        },
        select: { itemId: true, itemCode: true, description: true, brandName: true, additionalIdentifier: true },
      });
    });

    created.push({
      itemId: item.itemId.toString(),
      itemCode: item.itemCode,
      description: item.description,
      categoryCode,
      brandName: item.brandName,
      model: item.additionalIdentifier,
      highlighted: part.highlighted,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        schema,
        dryRun: DRY,
        excelParts: parts.length,
        createdCount: created.length,
        skippedCount: skipped.length,
        created,
        skipped,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
