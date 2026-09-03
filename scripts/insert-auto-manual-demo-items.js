/**
 * Insert 2 demo items for Item Code AUTO / MANUAL verification.
 * Run: node scripts/insert-auto-manual-demo-items.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('./apply-gcp-sql-env');
if (process.env.DIRECT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PREFIX = 'ITM';
const SEQ_WIDTH = 6;
const AUTO_RE = /^([A-Z0-9]+)-(\d+)$/;

function formatItemCode(prefix, sequence) {
  return `${prefix}-${String(sequence).padStart(SEQ_WIDTH, '0')}`;
}

function parseSeq(itemCode, prefix) {
  const m = String(itemCode).toUpperCase().match(AUTO_RE);
  if (!m || m[1] !== prefix) return null;
  return Number(m[2]);
}

async function nextAutoCode(companyId) {
  const existing = await prisma.item.findMany({
    where: { companyId, itemCode: { startsWith: `${PREFIX}-` } },
    select: { itemCode: true },
  });
  let maxSeq = 0;
  for (const row of existing) {
    const seq = parseSeq(row.itemCode, PREFIX);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  return formatItemCode(PREFIX, maxSeq + 1);
}

async function main() {
  const company = await prisma.company.findFirst({
    where: { companyCode: 'DEMO_ACME', deletedAt: null },
    select: { companyId: true, companyCode: true, name: true },
  });
  if (!company) throw new Error('DEMO_ACME company not found');

  const companyId = company.companyId;
  console.log('company', company.companyCode, companyId.toString(), company.name);

  // Ensure settings row exists (default AUTO)
  await prisma.companyItemSettings.upsert({
    where: { companyId },
    create: {
      companyId,
      itemCodeMode: 'AUTO',
      itemCodePrefix: PREFIX,
    },
    update: {},
  });

  const autoCode = await nextAutoCode(companyId);
  const manualCode = 'MANUAL-DEMO-001';

  const base = {
    companyId,
    itemType: 'item',
    isInventoryItem: true,
    isSalesItem: true,
    isPurchaseItem: true,
    status: 'active',
    isActive: true,
    manageBy: 'none',
    manageStockByWarehouse: true,
  };

  // AUTO entry — code looks like BE-generated ITM-######
  const autoExisting = await prisma.item.findFirst({
    where: { companyId, itemCode: autoCode, deletedAt: null },
  });
  let autoItem;
  if (autoExisting) {
    autoItem = autoExisting;
    console.log('AUTO already exists', autoCode);
  } else {
    autoItem = await prisma.item.create({
      data: {
        ...base,
        itemCode: autoCode,
        description: 'AUTO demo — system generated item code',
        itemGroup: 'Demo',
        brandName: 'AutoGen',
        remarks: 'Inserted to verify Item Code AUTO mode (ITM-######)',
        purchaseJson: { purchasingUomName: 'PC', factor1: 1 },
        salesJson: { salesUomName: 'PC' },
        inventoryJson: { uomName: 'PC', weight: 1 },
        planningJson: { procurementMethod: 'buy' },
        productionJson: { bomType: 'Production' },
        propertiesJson: { P1: true },
        metadata: { codeMode: 'AUTO', seededBy: 'insert-auto-manual-demo-items' },
      },
    });
    console.log('AUTO created', autoItem.itemCode, 'id', autoItem.itemId.toString());
  }

  // MANUAL entry — explicit unique code
  const manualExisting = await prisma.item.findFirst({
    where: { companyId, itemCode: manualCode, deletedAt: null },
  });
  let manualItem;
  if (manualExisting) {
    manualItem = manualExisting;
    console.log('MANUAL already exists', manualCode);
  } else {
    manualItem = await prisma.item.create({
      data: {
        ...base,
        itemCode: manualCode,
        description: 'MANUAL demo — user entered item code',
        itemGroup: 'Demo',
        brandName: 'ManualEntry',
        remarks: 'Inserted to verify Item Code MANUAL mode',
        purchaseJson: { purchasingUomName: 'PC', factor1: 1 },
        salesJson: { salesUomName: 'PC' },
        inventoryJson: { uomName: 'PC', weight: 2 },
        planningJson: { procurementMethod: 'buy' },
        productionJson: { bomType: 'Assembly' },
        propertiesJson: { P2: true },
        metadata: { codeMode: 'MANUAL', seededBy: 'insert-auto-manual-demo-items' },
      },
    });
    console.log('MANUAL created', manualItem.itemCode, 'id', manualItem.itemId.toString());
  }

  console.log(
    JSON.stringify(
      {
        company: company.companyCode,
        auto: { itemId: autoItem.itemId.toString(), itemCode: autoItem.itemCode },
        manual: { itemId: manualItem.itemId.toString(), itemCode: manualItem.itemCode },
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
