/**
 * Create DEMO-ITEM-006 with one attachment via API (login → POST item → multipart upload → PATCH).
 * Fallback: Prisma insert metadata-only if upload API fails.
 *
 * Run: node scripts/insert-demo-item-with-attachment.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (process.env.DIRECT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
}

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:3002/api/v1').replace(/\/$/, '');
const COMPANY_CODE = process.env.COMPANY_CODE || 'DEMO_ACME';
const EMPLOYEE_CODE = process.env.EMPLOYEE_CODE || 'ADMIN001';
const PASSWORD = process.env.PASSWORD || 'Admin@123';
const ITEM_CODE = 'DEMO-ITEM-006';

const prisma = new PrismaClient();

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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

function makeTinyPdf() {
  // Minimal valid-ish PDF bytes for upload testing
  const pdf = `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 12 Tf 50 150 Td (DEMO ITEM ATTACH) Tj ET
endstream
endobj
xref
0 5
trailer<< /Size 5 /Root 1 0 R >>
startxref
0
%%EOF
`;
  const dir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'demo-item-006-datasheet.pdf');
  fs.writeFileSync(filePath, pdf);
  return filePath;
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
  if (!ok) throw new Error(`Login failed (${status}): ${JSON.stringify(body)}`);
  const token = body?.data?.accessToken || body?.accessToken;
  const companyId =
    body?.data?.activeCompany?.companyId ||
    body?.data?.companies?.[0]?.companyId ||
    body?.activeCompany?.companyId;
  if (!token || !companyId) throw new Error(`Login missing token/companyId: ${JSON.stringify(body)}`);
  return { token, companyId: String(companyId) };
}

async function ensureViaApi() {
  const { token, companyId } = await login();
  console.log('API login OK, companyId', companyId);

  // Soft-skip if already exists: try create, on 409 find via list
  let itemId = null;
  const create = await jsonFetch(`${API_BASE}/companies/${companyId}/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      itemCode: ITEM_CODE,
      description: 'Demo item with file attachment',
      itemType: 'item',
      itemGroup: 'Demo',
      status: 'active',
      inventory: { weight: 0.5 },
      planning: { orderInterval: 'Weekly' },
      production: { bomType: 'Production' },
    }),
  });

  if (create.ok) {
    itemId = String(create.body?.data?.itemId || create.body?.itemId);
    console.log('Created', ITEM_CODE, 'itemId', itemId);
  } else if (create.status === 409) {
    const list = await jsonFetch(
      `${API_BASE}/companies/${companyId}/items?search=${encodeURIComponent(ITEM_CODE)}&limit=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const items = list.body?.data?.items || list.body?.items || [];
    const found = items.find((i) => String(i.itemCode).toUpperCase() === ITEM_CODE);
    if (!found) throw new Error('Item exists (409) but not found in list');
    itemId = String(found.itemId);
    console.log('Item already exists, itemId', itemId);
  } else {
    throw new Error(`Create failed (${create.status}): ${JSON.stringify(create.body)}`);
  }

  const pdfPath = makeTinyPdf();
  const blob = new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' });
  const form = new FormData();
  form.append('files', blob, 'demo-item-006-datasheet.pdf');

  const upload = await fetch(`${API_BASE}/companies/${companyId}/items/${itemId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const uploadText = await upload.text();
  let uploadBody;
  try {
    uploadBody = JSON.parse(uploadText);
  } catch {
    uploadBody = uploadText;
  }

  if (!upload.ok) {
    throw new Error(`Upload failed (${upload.status}): ${JSON.stringify(uploadBody)}`);
  }

  const attachments =
    uploadBody?.data?.attachments || uploadBody?.attachments || [];
  console.log('Uploaded attachments:', JSON.stringify(attachments, null, 2));

  const patch = await jsonFetch(`${API_BASE}/companies/${companyId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ attachments }),
  });
  if (!patch.ok) {
    throw new Error(`PATCH attachments failed (${patch.status}): ${JSON.stringify(patch.body)}`);
  }

  console.log('OK', ITEM_CODE, 'saved with attachment metadata');
  return true;
}

async function ensureViaDbFallback(err) {
  console.warn('API path failed, falling back to DB metadata insert:', err.message);

  const company = await prisma.company.findFirst({
    where: { companyCode: 'DEMO_ACME', deletedAt: null },
    select: { companyId: true },
  });
  if (!company) throw new Error('DEMO_ACME not found');

  let item = await prisma.item.findFirst({
    where: { companyId: company.companyId, itemCode: ITEM_CODE, deletedAt: null },
  });

  const today = new Date().toISOString().slice(0, 10);
  const asset = await prisma.fileAsset.create({
    data: {
      organizationId: String(company.companyId),
      fileName: 'demo-item-006-datasheet.pdf',
      originalName: 'demo-item-006-datasheet.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
      storageKey: `${company.companyId}/demo-item-006-datasheet.pdf`,
      bucket: 'erp-files',
      status: 'UPLOADED',
      entityType: 'item',
      entityId: item ? String(item.itemId) : null,
      publicUrl: null,
    },
  });

  const attachmentMeta = [
    {
      fileAssetId: asset.id,
      fileName: 'demo-item-006-datasheet.pdf',
      mimeType: 'application/pdf',
      fileSize: 512,
      storageKey: asset.storageKey,
      publicUrl: null,
      attachmentDate: today,
      status: 'uploaded',
    },
  ];

  if (!item) {
    item = await prisma.item.create({
      data: {
        companyId: company.companyId,
        itemCode: ITEM_CODE,
        description: 'Demo item with file attachment',
        itemType: 'item',
        itemGroup: 'Demo',
        status: 'active',
        isActive: true,
        manageBy: 'none',
        manageStockByWarehouse: true,
        inventoryJson: { weight: 0.5 },
        planningJson: { orderInterval: 'Weekly' },
        productionJson: { bomType: 'Production' },
        attachmentsJson: attachmentMeta,
      },
    });
    await prisma.fileAsset.update({
      where: { id: asset.id },
      data: { entityId: String(item.itemId) },
    });
  } else {
    item = await prisma.item.update({
      where: { itemId: item.itemId },
      data: { attachmentsJson: attachmentMeta },
    });
    await prisma.fileAsset.update({
      where: { id: asset.id },
      data: { entityId: String(item.itemId) },
    });
  }

  console.log('DB OK', ITEM_CODE, 'itemId', String(item.itemId), 'fileAssetId', asset.id);
}

async function main() {
  try {
    await ensureViaApi();
  } catch (e) {
    await ensureViaDbFallback(e);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
