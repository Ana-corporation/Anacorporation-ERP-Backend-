/**
 * POST 5 demo Item Master rows via live API (matches FE ITEM-MASTER-5-POST-ENTRIES.txt).
 *
 * Prerequisites:
 *   npm run seed:client-logins
 *   npm run start:dev   (Nest on port 3000 by default)
 *
 * Run:
 *   npm run seed:demo-items
 *
 * Env (optional):
 *   API_BASE_URL=http://localhost:3000/api/v1
 *   COMPANY_CODE=DEMO_ACME
 *   EMPLOYEE_CODE=ADMIN001
 *   PASSWORD=Admin@123
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Default matches ERP-Backend .env PORT=3002 (not 3000).
const API_BASE = (process.env.API_BASE_URL || 'http://localhost:3002/api/v1').replace(/\/$/, '');
const COMPANY_CODE = process.env.COMPANY_CODE || 'DEMO_ACME';
const EMPLOYEE_CODE = process.env.EMPLOYEE_CODE || 'ADMIN001';
const PASSWORD = process.env.PASSWORD || 'Admin@123';

const ITEMS = [
  {
    itemCode: 'DEMO-ITEM-001',
    description: 'ECON Bourdon tube pressure gauge',
    itemType: 'item',
    itemGroup: 'A-Brand',
    uomGroup: 'Manual',
    isInventoryItem: true,
    isSalesItem: true,
    isPurchaseItem: true,
    status: 'active',
    brandName: 'Econ',
    division: 'Flow Technology',
    valuationMethod: 'moving_average',
    itemCost: 42.5,
    purchase: {
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
    sales: {
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
    inventory: {
      uomName: 'PC',
      weight: 1.5,
      requiredQty: 10,
      minimumQty: 5,
      maximumQty: 100,
    },
    planning: {
      planningMethod: 'none',
      procurementMethod: 'buy',
      orderInterval: 'Weekly',
      minimumOrderQty: 1,
      leadTimeDays: 14,
    },
    production: {
      phantomItem: false,
      issueMethod: 'backflush',
      bomType: 'Production',
    },
    properties: { P1: true, P7: true },
  },
  {
    itemCode: 'DEMO-ITEM-002',
    description: 'Stainless steel valve body 2 inch',
    itemType: 'item',
    itemGroup: 'Valves',
    status: 'active',
    purchase: {
      mfrCatalogNo: 'VB-2IN-SS',
      purchasingUomName: 'PC',
      factor1: 1,
      factor2: 2,
      factor3: 1,
      factor4: 1,
    },
    inventory: { uomName: 'PC', weight: 2.8, minimumQty: 2, maximumQty: 50 },
    planning: { orderInterval: 'Monthly', procurementMethod: 'buy' },
    production: { bomType: 'Assembly' },
  },
  {
    itemCode: 'DEMO-ITEM-003',
    description: 'Rubber gasket set DN50',
    itemType: 'item',
    itemGroup: 'Seals',
    status: 'active',
    sales: {
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
    inventory: { weight: 0.3, requiredQty: 20, minimumQty: 10, maximumQty: 200 },
    planning: { orderInterval: 'Bi-weekly' },
    production: { bomType: 'Sales' },
  },
  {
    itemCode: 'DEMO-ITEM-004',
    description: 'Deep groove ball bearing 6205',
    itemType: 'item',
    itemGroup: 'Bearings',
    status: 'active',
    inventory: { uomName: 'PC', weight: 0.15, minimumQty: 50, maximumQty: 500 },
    planning: {
      planningMethod: 'mrp',
      procurementMethod: 'buy',
      orderInterval: 'Daily',
      orderMultiple: 10,
      minimumOrderQty: 50,
      leadTimeDays: 7,
      toleranceDays: 2,
    },
    production: { bomType: 'Production' },
  },
  {
    itemCode: 'DEMO-ITEM-005',
    description: 'On-site installation service',
    itemType: 'service',
    itemGroup: 'Services',
    isInventoryItem: false,
    isSalesItem: true,
    isPurchaseItem: false,
    status: 'active',
    inventory: { weight: 0 },
    planning: { orderInterval: 'On demand', procurementMethod: 'buy' },
    production: { phantomItem: false, bomType: 'Template' },
    properties: { P64: true },
  },
];

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function login() {
  const { ok, status, body } = await jsonFetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      companyCode: COMPANY_CODE,
      employeeCode: EMPLOYEE_CODE,
      password: PASSWORD,
    }),
  });
  if (!ok) {
    throw new Error(`Login failed (${status}): ${JSON.stringify(body)}`);
  }
  const token = body?.data?.accessToken || body?.accessToken;
  const companyId =
    body?.data?.activeCompany?.companyId ||
    body?.data?.companies?.[0]?.companyId ||
    body?.activeCompany?.companyId;
  if (!token || !companyId) {
    throw new Error(`Login response missing token or companyId: ${JSON.stringify(body)}`);
  }
  return { token, companyId: String(companyId) };
}

async function createItem(token, companyId, payload) {
  return jsonFetch(`${API_BASE}/companies/${companyId}/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

async function main() {
  console.log(`API: ${API_BASE}`);
  console.log(`Login: ${COMPANY_CODE} / ${EMPLOYEE_CODE}\n`);

  const { token, companyId } = await login();
  console.log(`Company ID: ${companyId}\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of ITEMS) {
    const { ok, status, body } = await createItem(token, companyId, item);
    if (ok) {
      created += 1;
      const id = body?.data?.itemId || body?.itemId || '—';
      console.log(`[201] ${item.itemCode} → itemId ${id}`);
    } else if (status === 409) {
      skipped += 1;
      console.log(`[409] ${item.itemCode} already exists — skipped`);
    } else {
      failed += 1;
      console.error(`[${status}] ${item.itemCode} FAILED:`, JSON.stringify(body));
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
