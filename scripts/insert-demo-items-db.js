/**
 * One-shot: insert 5 DEMO-ITEM rows directly into Neon (no HTTP).
 * Run: node scripts/insert-demo-items-db.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (process.env.DIRECT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ROWS = [
  {
    itemCode: 'DEMO-ITEM-001',
    description: 'ECON Bourdon tube pressure gauge',
    itemType: 'item',
    itemGroup: 'A-Brand',
    uomGroup: 'Manual',
    brandName: 'Econ',
    division: 'Flow Technology',
    valuationMethod: 'moving_average',
    itemCost: 42.5,
    purchaseJson: {
      purchasingUomName: 'PC',
      factor1: 1,
      factor2: 1,
      factor3: 1,
      factor4: 1,
      length: 10,
      width: 10,
      height: 12,
      volume: 1.2,
      volumeUnit: 'cf',
      weight: 1.5,
    },
    salesJson: {
      salesUomName: 'PC',
      packagingUomName: 'Box',
      itemsPerSalesUnit: 1,
      length: 10,
      width: 10,
      height: 12,
      volume: 1.2,
      volumeUnit: 'cf',
      weight: 1.5,
      factor1: 1,
      factor2: 1,
      factor3: 1,
      factor4: 1,
    },
    inventoryJson: { uomName: 'PC', weight: 1.5, requiredQty: 10, minimumQty: 5, maximumQty: 100 },
    planningJson: {
      planningMethod: 'none',
      procurementMethod: 'buy',
      orderInterval: 'Weekly',
      minimumOrderQty: 1,
      leadTimeDays: 14,
    },
    productionJson: { phantomItem: false, issueMethod: 'backflush', bomType: 'Production' },
    propertiesJson: { P1: true, P7: true },
  },
  {
    itemCode: 'DEMO-ITEM-002',
    description: 'Stainless steel valve body 2 inch',
    itemType: 'item',
    itemGroup: 'Valves',
    purchaseJson: {
      mfrCatalogNo: 'VB-2IN-SS',
      purchasingUomName: 'PC',
      factor1: 1,
      factor2: 2,
      factor3: 1,
      factor4: 1,
    },
    inventoryJson: { uomName: 'PC', weight: 2.8, minimumQty: 2, maximumQty: 50 },
    planningJson: { orderInterval: 'Monthly', procurementMethod: 'buy' },
    productionJson: { bomType: 'Assembly' },
  },
  {
    itemCode: 'DEMO-ITEM-003',
    description: 'Rubber gasket set DN50',
    itemType: 'item',
    itemGroup: 'Seals',
    salesJson: {
      salesUomName: 'SET',
      packagingUomName: 'Carton',
      quantityPerPackage: 10,
      length: 25,
      width: 15,
      height: 5,
      volume: 0.05,
      volumeUnit: 'cf',
      weight: 0.3,
      factor1: 1,
      factor2: 1,
      factor3: 1,
      factor4: 1,
    },
    inventoryJson: { weight: 0.3, requiredQty: 20, minimumQty: 10, maximumQty: 200 },
    planningJson: { orderInterval: 'Bi-weekly' },
    productionJson: { bomType: 'Sales' },
  },
  {
    itemCode: 'DEMO-ITEM-004',
    description: 'Deep groove ball bearing 6205',
    itemType: 'item',
    itemGroup: 'Bearings',
    inventoryJson: { uomName: 'PC', weight: 0.15, minimumQty: 50, maximumQty: 500 },
    planningJson: {
      planningMethod: 'mrp',
      procurementMethod: 'buy',
      orderInterval: 'Daily',
      orderMultiple: 10,
      minimumOrderQty: 50,
      leadTimeDays: 7,
      toleranceDays: 2,
    },
    productionJson: { bomType: 'Production' },
  },
  {
    itemCode: 'DEMO-ITEM-005',
    description: 'On-site installation service',
    itemType: 'service',
    itemGroup: 'Services',
    isInventoryItem: false,
    isSalesItem: true,
    isPurchaseItem: false,
    inventoryJson: { weight: 0 },
    planningJson: { orderInterval: 'On demand', procurementMethod: 'buy' },
    productionJson: { phantomItem: false, bomType: 'Template' },
    propertiesJson: { P64: true },
  },
];

async function main() {
  const company = await prisma.company.findFirst({
    where: { companyCode: 'DEMO_ACME', deletedAt: null },
    select: { companyId: true, companyCode: true },
  });
  if (!company) throw new Error('DEMO_ACME company not found');
  console.log('Company', company.companyCode, String(company.companyId));

  for (const r of ROWS) {
    const existing = await prisma.item.findFirst({
      where: { companyId: company.companyId, itemCode: r.itemCode, deletedAt: null },
      select: { itemId: true },
    });
    if (existing) {
      console.log('SKIP', r.itemCode, 'already exists id', String(existing.itemId));
      continue;
    }
    const created = await prisma.item.create({
      data: {
        companyId: company.companyId,
        itemCode: r.itemCode,
        description: r.description,
        itemType: r.itemType || 'item',
        itemGroup: r.itemGroup || null,
        uomGroup: r.uomGroup || null,
        brandName: r.brandName || null,
        division: r.division || null,
        valuationMethod: r.valuationMethod || null,
        itemCost: r.itemCost ?? null,
        isInventoryItem: r.isInventoryItem !== false,
        isSalesItem: r.isSalesItem !== false,
        isPurchaseItem: r.isPurchaseItem !== false,
        status: 'active',
        isActive: true,
        manageStockByWarehouse: true,
        manageBy: 'none',
        purchaseJson: r.purchaseJson || undefined,
        salesJson: r.salesJson || undefined,
        inventoryJson: r.inventoryJson || undefined,
        planningJson: r.planningJson || undefined,
        productionJson: r.productionJson || undefined,
        propertiesJson: r.propertiesJson || undefined,
      },
      select: { itemId: true, itemCode: true },
    });
    console.log('OK', created.itemCode, 'itemId', String(created.itemId));
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
