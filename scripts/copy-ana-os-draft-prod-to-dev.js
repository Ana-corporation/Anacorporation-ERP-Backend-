/**
 * Copy Ana Opening Stock draft OS-000004 from Ana_corporation_db → Erp_test_db.
 * Remaps item / warehouse / bin IDs by business codes (IDs differ across schemas).
 *
 *   node scripts/copy-ana-os-draft-prod-to-dev.js
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const COMPANY_ID = 28n;
const SOURCE_DOCUMENT_ID = 6n;
const SRC = 'Ana_corporation_db';
const DST = 'Erp_test_db';

function parse(f) {
  const o = {};
  if (!fs.existsSync(f)) return o;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[t.slice(0, eq).trim()] = v;
  }
  return o;
}

async function main() {
  const env = {
    ...parse(path.join(__dirname, '..', '.env.development')),
    ...parse(path.join(__dirname, '..', '.env.production')),
  };
  const url = `postgresql://${encodeURIComponent(env.GCP_SQL_USER)}:${encodeURIComponent(env.GCP_SQL_PASSWORD)}@${env.GCP_SQL_IP || '127.0.0.1'}:${env.GCP_SQL_PORT || '5433'}/${env.GCP_SQL_DATABASE || 'swenter-dev'}?schema=${encodeURIComponent(DST)}&sslmode=${env.GCP_SQL_SSL_MODE || 'disable'}&connect_timeout=30`;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const srcDoc = (
    await prisma.$queryRawUnsafe(
      `SELECT * FROM "${SRC}".inventory_documents WHERE document_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      SOURCE_DOCUMENT_ID,
      COMPANY_ID,
    )
  )[0];
  if (!srcDoc) throw new Error('Source document not found');

  const srcLines = await prisma.$queryRawUnsafe(
    `SELECT l.*, i.item_code, w.warehouse_code, b.bin_code
     FROM "${SRC}".inventory_document_lines l
     JOIN "${SRC}".items i ON i.item_id = l.item_id
     JOIN "${SRC}".warehouses w ON w.warehouse_id = l.warehouse_id
     LEFT JOIN "${SRC}".storage_bins b ON b.storage_bin_id = l.storage_bin_id
     WHERE l.document_id = $1 AND l.company_id = $2
     ORDER BY l.line_no`,
    SOURCE_DOCUMENT_ID,
    COMPANY_ID,
  );

  // Maps on DEV
  const itemMapRows = await prisma.$queryRawUnsafe(
    `SELECT item_code, item_id FROM "${DST}".items WHERE company_id = $1 AND deleted_at IS NULL`,
    COMPANY_ID,
  );
  const itemByCode = new Map(itemMapRows.map((r) => [String(r.item_code).toUpperCase(), r.item_id]));

  const whMapRows = await prisma.$queryRawUnsafe(
    `SELECT warehouse_code, warehouse_id FROM "${DST}".warehouses WHERE company_id = $1 AND deleted_at IS NULL`,
    COMPANY_ID,
  );
  const whByCode = new Map(whMapRows.map((r) => [String(r.warehouse_code).toUpperCase(), r.warehouse_id]));

  // Ensure warehouses used by source exist on DEV (copy missing by code)
  const srcWhCodes = [...new Set(srcLines.map((l) => String(l.warehouse_code).toUpperCase()))];
  for (const code of srcWhCodes) {
    if (whByCode.has(code)) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${DST}".warehouses (
         company_id, branch_id, store_category_id, warehouse_code, name, address, location_type,
         bin_management, vendor_id, is_default, is_active, created_by, created_at, row_version
       )
       SELECT company_id, branch_id, store_category_id, warehouse_code, name, address, location_type,
              bin_management, vendor_id, is_default, is_active, created_by, created_at, row_version
       FROM "${SRC}".warehouses
       WHERE company_id = $1 AND upper(warehouse_code) = $2 AND deleted_at IS NULL
       LIMIT 1`,
      COMPANY_ID,
      code,
    );
    const row = (
      await prisma.$queryRawUnsafe(
        `SELECT warehouse_id FROM "${DST}".warehouses WHERE company_id = $1 AND upper(warehouse_code) = $2 AND deleted_at IS NULL`,
        COMPANY_ID,
        code,
      )
    )[0];
    if (row) whByCode.set(code, row.warehouse_id);
  }

  // Bin map: warehouse_id + bin_code on DEV
  const binMapRows = await prisma.$queryRawUnsafe(
    `SELECT warehouse_id, upper(bin_code) AS bin_code, storage_bin_id
     FROM "${DST}".storage_bins WHERE company_id = $1 AND deleted_at IS NULL`,
    COMPANY_ID,
  );
  const binByWhCode = new Map(binMapRows.map((r) => [`${r.warehouse_id}:${r.bin_code}`, r.storage_bin_id]));

  // Ensure bins
  for (const line of srcLines) {
    if (!line.bin_code) continue;
    const whId = whByCode.get(String(line.warehouse_code).toUpperCase());
    if (!whId) continue;
    const key = `${whId}:${String(line.bin_code).toUpperCase()}`;
    if (binByWhCode.has(key)) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${DST}".storage_bins (
         company_id, warehouse_id, bin_code, bin_name, is_active, status, is_system,
         created_by, created_at, row_version
       )
       SELECT $1, $2, s.bin_code, s.bin_name, s.is_active, s.status, s.is_system,
              s.created_by, s.created_at, s.row_version
       FROM "${SRC}".storage_bins s
       WHERE s.storage_bin_id = $3
       LIMIT 1`,
      COMPANY_ID,
      whId,
      line.storage_bin_id,
    );
    const row = (
      await prisma.$queryRawUnsafe(
        `SELECT storage_bin_id FROM "${DST}".storage_bins
         WHERE warehouse_id = $1 AND upper(bin_code) = $2 AND deleted_at IS NULL`,
        whId,
        String(line.bin_code).toUpperCase(),
      )
    )[0];
    if (row) binByWhCode.set(key, row.storage_bin_id);
  }

  // Missing items by code — report; try create minimal from source if UoM/group exist
  const missingCodes = [
    ...new Set(
      srcLines
        .map((l) => String(l.item_code).toUpperCase())
        .filter((c) => !itemByCode.has(c)),
    ),
  ];

  let itemsCreated = 0;
  for (const code of missingCodes) {
    const srcItem = (
      await prisma.$queryRawUnsafe(
        `SELECT i.*, u.code AS uom_code
         FROM "${SRC}".items i
         LEFT JOIN "${SRC}".uoms u ON u.uom_id = i.inventory_uom_id
         WHERE i.company_id = $1 AND upper(i.item_code) = $2 AND i.deleted_at IS NULL
         LIMIT 1`,
        COMPANY_ID,
        code,
      )
    )[0];
    if (!srcItem) continue;

    let uomId = null;
    if (srcItem.uom_code) {
      const u = (
        await prisma.$queryRawUnsafe(
          `SELECT uom_id FROM "${DST}".uoms WHERE company_id = $1 AND upper(code) = upper($2) AND deleted_at IS NULL LIMIT 1`,
          COMPANY_ID,
          srcItem.uom_code,
        )
      )[0];
      uomId = u?.uom_id ?? null;
    }

    // Prefer existing group by same id if present, else null
    let groupId = null;
    if (srcItem.item_group_id) {
      const g = (
        await prisma.$queryRawUnsafe(
          `SELECT item_group_id FROM "${DST}".item_groups WHERE item_group_id = $1`,
          srcItem.item_group_id,
        )
      )[0];
      groupId = g?.item_group_id ?? null;
    }

    let storeCatId = null;
    if (srcItem.store_category_id) {
      const sc = (
        await prisma.$queryRawUnsafe(
          `SELECT store_category_id FROM "${DST}".store_categories WHERE store_category_id = $1`,
          srcItem.store_category_id,
        )
      )[0];
      storeCatId = sc?.store_category_id ?? null;
      if (!storeCatId) {
        const byCode = (
          await prisma.$queryRawUnsafe(
            `SELECT d.store_category_id
             FROM "${DST}".store_categories d
             JOIN "${SRC}".store_categories s ON s.store_category_id = $1
             WHERE d.company_id = $2 AND d.code = s.code AND d.deleted_at IS NULL
             LIMIT 1`,
            srcItem.store_category_id,
            COMPANY_ID,
          )
        )[0];
        storeCatId = byCode?.store_category_id ?? null;
      }
    }

    try {
      const created = await prisma.item.create({
        data: {
          companyId: COMPANY_ID,
          itemCode: srcItem.item_code,
          description: srcItem.description,
          status: srcItem.status || 'active',
          isInventoryItem: srcItem.is_inventory_item ?? true,
          isActive: srcItem.is_active ?? true,
          inventoryUomId: uomId,
          itemGroupId: groupId,
          storeCategoryId: storeCatId,
          manageBy: srcItem.manage_by || 'none',
        },
      });
      itemByCode.set(code, created.itemId);
      itemsCreated += 1;
    } catch (e) {
      console.warn(`Could not create missing item ${code}: ${e.message}`);
    }
  }

  // Remap default warehouse
  let defaultWarehouseId = null;
  if (srcDoc.default_warehouse_id) {
    const srcWh = (
      await prisma.$queryRawUnsafe(
        `SELECT warehouse_code FROM "${SRC}".warehouses WHERE warehouse_id = $1`,
        srcDoc.default_warehouse_id,
      )
    )[0];
    if (srcWh) defaultWarehouseId = whByCode.get(String(srcWh.warehouse_code).toUpperCase()) ?? null;
  }

  // Upsert document on DEV
  const existing = await prisma.$queryRawUnsafe(
    `SELECT document_id FROM "${DST}".inventory_documents
     WHERE company_id = $1 AND document_type = 'OPENING_STOCK' AND document_number = $2`,
    COMPANY_ID,
    srcDoc.document_number,
  );

  let targetDocumentId;
  if (existing.length) {
    targetDocumentId = existing[0].document_id;
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${DST}".inventory_document_lines WHERE document_id = $1`,
      targetDocumentId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "${DST}".inventory_documents SET
         document_date = $2,
         status = 'DRAFT',
         remarks = $3,
         default_warehouse_id = $4,
         default_store_category_id = NULL,
         total_lines = $5,
         total_quantity = $6,
         total_value = $7,
         posted_at = NULL,
         posted_by = NULL,
         deleted_at = NULL,
         deleted_by = NULL,
         updated_at = NOW()
       WHERE document_id = $1`,
      targetDocumentId,
      srcDoc.document_date,
      srcDoc.remarks,
      defaultWarehouseId,
      srcDoc.total_lines,
      srcDoc.total_quantity,
      srcDoc.total_value,
    );
  } else {
    const created = await prisma.inventoryDocument.create({
      data: {
        companyId: COMPANY_ID,
        documentType: 'OPENING_STOCK',
        documentNumber: srcDoc.document_number,
        documentDate: srcDoc.document_date,
        status: 'DRAFT',
        remarks: srcDoc.remarks,
        defaultWarehouseId,
        totalLines: Number(srcDoc.total_lines),
        totalQuantity: srcDoc.total_quantity,
        totalValue: srcDoc.total_value,
      },
    });
    targetDocumentId = created.documentId;
  }

  const skipped = [];
  const mapped = [];
  for (const line of srcLines) {
    const itemId = itemByCode.get(String(line.item_code).toUpperCase());
    const warehouseId = whByCode.get(String(line.warehouse_code).toUpperCase());
    if (!itemId || !warehouseId) {
      skipped.push({
        lineNo: line.line_no,
        itemCode: line.item_code,
        reason: !itemId ? 'item_missing' : 'warehouse_missing',
      });
      continue;
    }
    let storageBinId = null;
    if (line.bin_code) {
      storageBinId = binByWhCode.get(`${warehouseId}:${String(line.bin_code).toUpperCase()}`) ?? null;
    }
    mapped.push({
      documentId: targetDocumentId,
      companyId: COMPANY_ID,
      lineNo: Number(line.line_no),
      itemId,
      warehouseId,
      storageBinId,
      uom: line.uom,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      remarks: line.remarks,
      batchNo: line.batch_no,
      serialNo: line.serial_no,
      brand: line.brand,
      lineTotal: line.line_total,
      zeroPriceConfirmed: Boolean(line.zero_price_confirmed),
      revision: line.revision,
      partCode: line.part_code,
      materialGrade: line.material_grade,
      size: line.size,
    });
  }

  const chunk = 100;
  for (let i = 0; i < mapped.length; i += chunk) {
    await prisma.inventoryDocumentLine.createMany({ data: mapped.slice(i, i + chunk) });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "${DST}".inventory_documents SET
       total_lines = (SELECT count(*)::int FROM "${DST}".inventory_document_lines WHERE document_id = $1),
       total_quantity = COALESCE((SELECT sum(quantity) FROM "${DST}".inventory_document_lines WHERE document_id = $1), 0),
       total_value = COALESCE((SELECT sum(line_total) FROM "${DST}".inventory_document_lines WHERE document_id = $1), 0)
     WHERE document_id = $1`,
    targetDocumentId,
  );

  const verify = (
    await prisma.$queryRawUnsafe(
      `SELECT document_id, document_number, status::text AS status,
              (SELECT count(*)::int FROM "${DST}".inventory_document_lines WHERE document_id = d.document_id) AS lines
       FROM "${DST}".inventory_documents d WHERE document_id = $1`,
      targetDocumentId,
    )
  )[0];

  console.log(
    JSON.stringify(
      {
        ok: true,
        targetDocumentId: verify.document_id.toString(),
        documentNumber: verify.document_number,
        status: verify.status,
        lines: verify.lines,
        sourceLines: srcLines.length,
        skipped: skipped.length,
        skippedSample: skipped.slice(0, 10),
        itemsCreated,
        warehousesOnDev: whByCode.size,
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
