/**
 * One-shot dummy data so Material Inward Receiving can be clicked through.
 * Login: DEMO_ACME / ADMIN001 / Admin@123
 */
const API_BASE = (process.env.API_BASE_URL || 'http://localhost:3002/api/v1').replace(/\/$/, '');
const COMPANY_CODE = process.env.COMPANY_CODE || 'DEMO_ACME';
const EMPLOYEE_CODE = process.env.EMPLOYEE_CODE || 'ADMIN001';
const PASSWORD = process.env.PASSWORD || 'Admin@123';

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
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

function dataOf(body) {
  return body?.data ?? body;
}

function rowsOf(body) {
  const data = dataOf(body);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['items', 'rows', 'data']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

async function login() {
  const { ok, status, body } = await jsonFetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ companyCode: COMPANY_CODE, employeeCode: EMPLOYEE_CODE, password: PASSWORD }),
  });
  if (!ok) throw new Error(`Login failed (${status}): ${JSON.stringify(body)}`);
  const payload = dataOf(body);
  const token = payload?.accessToken || body?.accessToken;
  const companyId = payload?.activeCompany?.companyId || payload?.companies?.[0]?.companyId;
  if (!token || !companyId) throw new Error(`Login missing token or company: ${JSON.stringify(body)}`);
  return { token, companyId: String(companyId) };
}

async function main() {
  console.log(`API ${API_BASE}`);
  const { token, companyId } = await login();
  const auth = { Authorization: `Bearer ${token}` };
  const company = `${API_BASE}/companies/${companyId}`;
  console.log(`Company ${companyId}`);

  const vendorsRes = await jsonFetch(`${company}/vendors?page=1&limit=20`, { headers: auth });
  let vendor = rowsOf(vendorsRes.body)[0];
  if (!vendor) {
    const created = await jsonFetch(`${company}/vendors`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        supplierType: 'RM Supplier',
        name: 'Inward Demo Supplier',
        email: 'inward.demo@example.com',
        city: 'Coimbatore',
        country: 'India',
      }),
    });
    if (!created.ok) throw new Error(`Vendor create ${created.status}: ${JSON.stringify(created.body)}`);
    vendor = dataOf(created.body);
    console.log(`Created vendor ${vendor.vendorCode || ''} ${vendor.name} id=${vendor.vendorId}`);
  } else {
    console.log(`Using vendor ${vendor.vendorCode || ''} ${vendor.name} id=${vendor.vendorId}`);
  }

  const itemsRes = await jsonFetch(`${company}/items?page=1&limit=20`, { headers: auth });
  let item = rowsOf(itemsRes.body).find((row) => row.isPurchaseItem !== false) || rowsOf(itemsRes.body)[0];
  if (!item) {
    const created = await jsonFetch(`${company}/items`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        itemCode: 'INWARD-DEMO-001',
        description: 'Inward demo raw material',
        itemType: 'item',
        isInventoryItem: true,
        isPurchaseItem: true,
        status: 'active',
        valuationMethod: 'moving_average',
        purchase: { purchasingUomName: 'PC' },
        inventory: { uomName: 'PC' },
      }),
    });
    if (!created.ok) throw new Error(`Item create ${created.status}: ${JSON.stringify(created.body)}`);
    item = dataOf(created.body);
    console.log(`Created item ${item.itemCode} id=${item.itemId}`);
  } else {
    console.log(`Using item ${item.itemCode} id=${item.itemId}`);
  }

  const branchesRes = await jsonFetch(`${company}/branches?page=1&limit=20`, { headers: auth });
  let branch = rowsOf(branchesRes.body)[0];
  if (!branch) {
    const created = await jsonFetch(`${company}/branches`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Inward Demo Site', city: 'Coimbatore', country: 'India' }),
    });
    if (!created.ok) throw new Error(`Branch create ${created.status}: ${JSON.stringify(created.body)}`);
    branch = dataOf(created.body);
    console.log(`Created branch ${branch.name} id=${branch.branchId}`);
  } else {
    console.log(`Using branch ${branch.name} id=${branch.branchId}`);
  }

  const warehousesRes = await jsonFetch(`${company}/warehouses?page=1&limit=20`, { headers: auth });
  let warehouse = rowsOf(warehousesRes.body)[0];
  if (!warehouse) {
    const created = await jsonFetch(`${company}/warehouses`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: 'Inward Demo Store',
        branchId: String(branch.branchId),
        locationType: 'RawMaterialStore',
        isActive: true,
      }),
    });
    if (!created.ok) throw new Error(`Warehouse create ${created.status}: ${JSON.stringify(created.body)}`);
    warehouse = dataOf(created.body);
    console.log(`Created warehouse ${warehouse.warehouseCode || ''} ${warehouse.name} id=${warehouse.warehouseId}`);
  } else {
    console.log(`Using warehouse ${warehouse.warehouseCode || ''} ${warehouse.name} id=${warehouse.warehouseId}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const poRes = await jsonFetch(`${company}/material-inward/purchase-orders`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      poDate: today,
      supplierId: String(vendor.vendorId),
      remarks: 'Dummy order for inward process check',
      lines: [
        {
          itemId: String(item.itemId),
          warehouseId: String(warehouse.warehouseId),
          orderQty: 10,
          uomCode: 'PCS',
          unitPrice: 100,
          taxPct: 18,
          qcRequired: true,
          batchControlled: true,
          serialControlled: false,
        },
      ],
    }),
  });
  if (!poRes.ok) throw new Error(`PO create ${poRes.status}: ${JSON.stringify(poRes.body)}`);
  const po = dataOf(poRes.body);
  console.log(`Created purchase order ${po.poNo || po.poNumber || ''} id=${po.poId || po.id}`);

  const binRes = await jsonFetch(`${company}/material-inward/locations`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      warehouseId: String(warehouse.warehouseId),
      locationType: 'BIN',
      locationCode: 'BIN-A01',
      locationName: 'Aisle A Bin 01',
    }),
  });
  if (binRes.ok) {
    const bin = dataOf(binRes.body);
    console.log(`Created bin ${bin.locationCode || 'BIN-A01'} id=${bin.id || bin.locationId}`);
  } else if (binRes.status === 409) {
    console.log('Bin BIN-A01 already exists');
  } else {
    console.log(`Bin skipped (${binRes.status}): ${JSON.stringify(binRes.body)}`);
  }

  console.log('\nOpen Material Inward → Receiving and click Receive on the new purchase order.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
