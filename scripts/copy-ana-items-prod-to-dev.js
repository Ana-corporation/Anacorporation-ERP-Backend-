/**
 * Copy missing Ana Material Master items from Ana_corporation_db → Erp_test_db.
 * Remaps store / UoM / item-group by business codes. Skips machines and codes
 * that already exist on test (including soft-deleted SERVO SET rows).
 *
 *   node scripts/copy-ana-items-prod-to-dev.js
 *   node scripts/copy-ana-items-prod-to-dev.js --dry-run
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const COMPANY_ID = 28n;
const SRC = 'Ana_corporation_db';
const DST = 'Erp_test_db';
const DRY = process.argv.includes('--dry-run');

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

  const schema = (await prisma.$queryRawUnsafe(`select current_schema() as s`))[0].s;
  if (schema !== DST) throw new Error(`Expected ${DST}, got ${schema}`);

  // --- store map: live id → test id (by code_prefix) ---
  const stores = await prisma.$queryRawUnsafe(
    `
    SELECT s.store_category_id AS src_id, d.store_category_id AS dst_id,
           s.code_prefix, s.name
    FROM "${SRC}".store_categories s
    JOIN "${DST}".store_categories d
      ON d.company_id = s.company_id
     AND upper(d.code_prefix) = upper(s.code_prefix)
     AND d.deleted_at IS NULL
    WHERE s.company_id = $1 AND s.deleted_at IS NULL
    `,
    COMPANY_ID,
  );
  const storeBySrc = new Map(stores.map((r) => [String(r.src_id), r.dst_id]));
  const storeByPrefix = new Map(stores.map((r) => [String(r.code_prefix).toUpperCase(), r.dst_id]));

  // Sub Contractor Store (SCS) has 0 materials on live — skip creating it on test.

  // --- ensure missing item groups SF / FF ---
  const missingGroups = await prisma.$queryRawUnsafe(
    `
    SELECT g1.*
    FROM "${SRC}".item_groups g1
    JOIN "${SRC}".store_categories sc1 ON sc1.store_category_id = g1.store_category_id
    WHERE g1.company_id = $1 AND g1.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "${DST}".item_groups g2
        JOIN "${DST}".store_categories sc2 ON sc2.store_category_id = g2.store_category_id
        WHERE g2.company_id = $1 AND g2.deleted_at IS NULL
          AND upper(COALESCE(g2.category_code,'')) = upper(COALESCE(g1.category_code,''))
          AND upper(sc2.code_prefix) = upper(sc1.code_prefix)
          AND upper(g2.name) = upper(g1.name)
      )
    `,
    COMPANY_ID,
  );
  if (!DRY) {
    for (const g of missingGroups) {
      const dstStoreId = storeBySrc.get(String(g.store_category_id));
      if (!dstStoreId) throw new Error(`No test store for group ${g.name}`);
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "${DST}".item_groups (
          company_id, store_category_id, parent_id, name, category_code, description,
          sort_order, allow_opening_create, material_stage, is_active, created_by, created_at
        ) VALUES (
          $1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11
        )
        `,
        COMPANY_ID,
        dstStoreId,
        g.name,
        g.category_code,
        g.description,
        g.sort_order ?? 0,
        g.allow_opening_create ?? false,
        g.material_stage,
        g.is_active ?? true,
        g.created_by,
        g.created_at ?? new Date(),
      );
    }
  }

  // --- group map: live id → test id ---
  const groups = await prisma.$queryRawUnsafe(
    `
    SELECT g1.item_group_id AS src_id, g2.item_group_id AS dst_id
    FROM "${SRC}".item_groups g1
    JOIN "${SRC}".store_categories sc1 ON sc1.store_category_id = g1.store_category_id
    JOIN "${DST}".store_categories sc2
      ON sc2.company_id = sc1.company_id AND upper(sc2.code_prefix)=upper(sc1.code_prefix) AND sc2.deleted_at IS NULL
    JOIN "${DST}".item_groups g2
      ON g2.company_id = g1.company_id
     AND g2.store_category_id = sc2.store_category_id
     AND g2.deleted_at IS NULL
     AND upper(COALESCE(g2.category_code,'')) = upper(COALESCE(g1.category_code,''))
     AND upper(g2.name) = upper(g1.name)
    WHERE g1.company_id = $1 AND g1.deleted_at IS NULL
    `,
    COMPANY_ID,
  );
  const groupBySrc = new Map(groups.map((r) => [String(r.src_id), r.dst_id]));

  // --- uom map ---
  const uoms = await prisma.$queryRawUnsafe(
    `
    SELECT u1.uom_id AS src_id, u2.uom_id AS dst_id
    FROM "${SRC}".uoms u1
    JOIN "${DST}".uoms u2
      ON u2.company_id = u1.company_id AND upper(u2.code)=upper(u1.code) AND u2.deleted_at IS NULL
    WHERE u1.company_id = $1 AND u1.deleted_at IS NULL
    `,
    COMPANY_ID,
  );
  const uomBySrc = new Map(uoms.map((r) => [String(r.src_id), r.dst_id]));

  // --- custom field definitions ---
  const liveCfs = await prisma.$queryRawUnsafe(
    `
    SELECT * FROM "${SRC}".custom_field_definitions
    WHERE company_id = $1 AND entity_type = 'item' AND deleted_at IS NULL
      AND field_name IN ('materialCategory','materialType','procurementType')
    ORDER BY sort_order
    `,
    COMPANY_ID,
  );
  if (!DRY) {
    for (const d of liveCfs) {
      const exists = (
        await prisma.$queryRawUnsafe(
          `
          SELECT field_id FROM "${DST}".custom_field_definitions
          WHERE company_id=$1 AND entity_type='item' AND field_name=$2 AND deleted_at IS NULL
          `,
          COMPANY_ID,
          d.field_name,
        )
      )[0];
      if (exists) continue;
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "${DST}".custom_field_definitions (
          company_id, entity_type, field_name, display_name, field_type, is_required,
          default_value, validation, options, sort_order, is_active, is_filterable,
          created_by, created_at, section_key, placeholder, help_text, description,
          is_read_only, is_hidden, is_searchable, is_sortable, is_exportable, is_printable,
          is_registration_visible
        ) VALUES (
          $1,'item',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,$23,$24
        )
        `,
        COMPANY_ID,
        d.field_name,
        d.display_name,
        d.field_type,
        d.is_required,
        d.default_value,
        d.validation,
        d.options ? JSON.stringify(d.options) : null,
        d.sort_order,
        d.is_active,
        d.is_filterable,
        d.created_by,
        d.created_at ?? new Date(),
        d.section_key,
        d.placeholder,
        d.help_text,
        d.description,
        d.is_read_only ?? false,
        d.is_hidden ?? false,
        d.is_searchable ?? false,
        d.is_sortable ?? false,
        d.is_exportable ?? true,
        d.is_printable ?? true,
        d.is_registration_visible ?? false,
      );
    }
  }

  const cfMapRows = await prisma.$queryRawUnsafe(
    `
    SELECT s.field_name, s.field_id AS src_id, d.field_id AS dst_id
    FROM "${SRC}".custom_field_definitions s
    JOIN "${DST}".custom_field_definitions d
      ON d.company_id = s.company_id AND d.entity_type = s.entity_type
     AND d.field_name = s.field_name AND d.deleted_at IS NULL
    WHERE s.company_id = $1 AND s.entity_type = 'item' AND s.deleted_at IS NULL
      AND s.field_name IN ('materialCategory','materialType','procurementType')
    `,
    COMPANY_ID,
  );
  const cfBySrc = new Map(cfMapRows.map((r) => [String(r.src_id), r.dst_id]));

  // --- missing live items (active, non-machine, no any-row on test by code) ---
  const missing = await prisma.$queryRawUnsafe(
    `
    SELECT i.*
    FROM "${SRC}".items i
    WHERE i.company_id = $1
      AND i.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM "${SRC}".machines m WHERE m.item_id = i.item_id)
      AND NOT EXISTS (
        SELECT 1 FROM "${DST}".items t
        WHERE t.company_id = $1 AND t.item_code = i.item_code
      )
    ORDER BY i.item_id
    `,
    COMPANY_ID,
  );

  const skipSoft = (
    await prisma.$queryRawUnsafe(
      `
      SELECT t.item_code
      FROM "${DST}".items t
      WHERE t.company_id = $1 AND t.deleted_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "${SRC}".items i
          WHERE i.company_id = $1 AND i.item_code = t.item_code AND i.deleted_at IS NULL
        )
      `,
      COMPANY_ID,
    )
  ).map((r) => r.item_code);

  if (DRY) {
    const byStore = {};
    for (const i of missing) {
      const prefix =
        stores.find((s) => String(s.src_id) === String(i.store_category_id))?.code_prefix || '?';
      byStore[prefix] = (byStore[prefix] || 0) + 1;
    }
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          wouldInsert: missing.length,
          byStore,
          skippedSoftDeletedOnTest: skipSoft,
          groupsToCreate: missingGroups.map((g) => g.name),
          customFieldsToEnsure: liveCfs.map((d) => d.field_name),
        },
        null,
        2,
      ),
    );
    await prisma.$disconnect();
    return;
  }

  let inserted = 0;
  const codeToNewId = new Map();
  const BATCH = 50;

  for (let offset = 0; offset < missing.length; offset += BATCH) {
    const chunk = missing.slice(offset, offset + BATCH);
    await prisma.$transaction(async (tx) => {
      for (const i of chunk) {
        const dstStore = i.store_category_id != null ? storeBySrc.get(String(i.store_category_id)) : null;
        if (i.store_category_id != null && dstStore == null) {
          throw new Error(`No store map for item ${i.item_code}`);
        }
        const dstGroup = i.item_group_id != null ? groupBySrc.get(String(i.item_group_id)) : null;
        if (i.item_group_id != null && dstGroup == null) {
          throw new Error(`No group map for item ${i.item_code} group=${i.item_group_id}`);
        }
        const dstUom = i.inventory_uom_id != null ? uomBySrc.get(String(i.inventory_uom_id)) : null;
        if (i.inventory_uom_id != null && dstUom == null) {
          throw new Error(`No uom map for item ${i.item_code}`);
        }

        const rows = await tx.$queryRawUnsafe(
          `
          INSERT INTO "${DST}".items (
            company_id, item_code, description, old_code, item_type, item_group, uom_group,
            barcode, price_list, unit_price, currency_code,
            is_inventory_item, is_sales_item, is_purchase_item,
            do_not_apply_discount_groups, manufacturer, additional_identifier, shipping_type,
            manage_by, status, active_from, active_to,
            net_weight_kg, gross_weight_kg, division, core_activity, major_group, brand_name,
            effective_date, customer_stock_no, stock_to_be, stock_dio_days, contract_items_for,
            preferred_vendor_id, valuation_method, item_cost, manage_stock_by_warehouse,
            remarks, purchase_json, sales_json, inventory_json, planning_json, production_json,
            properties_json, attachments_json, metadata,
            is_active, created_by, created_at, updated_by, updated_at, row_version,
            store_category_id, item_group_id, inventory_uom_id, image_file_asset_id,
            material_stage, previous_stage_item_id
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,$11,
            $12,$13,$14,
            $15,$16,$17,$18,
            $19,$20,$21,$22,
            $23,$24,$25,$26,$27,$28,
            $29,$30,$31,$32,$33,
            NULL,$34,$35,$36,
            $37,$38::jsonb,$39::jsonb,$40::jsonb,$41::jsonb,$42::jsonb,
            $43::jsonb,$44::jsonb,$45::jsonb,
            $46,$47,$48,$49,$50,1,
            $51,$52,$53,$54,
            $55,NULL
          )
          RETURNING item_id, item_code
          `,
          COMPANY_ID,
          i.item_code,
          i.description,
          i.old_code,
          i.item_type,
          i.item_group,
          i.uom_group,
          i.barcode,
          i.price_list,
          i.unit_price,
          i.currency_code,
          i.is_inventory_item,
          i.is_sales_item,
          i.is_purchase_item,
          i.do_not_apply_discount_groups,
          i.manufacturer,
          i.additional_identifier,
          i.shipping_type,
          i.manage_by,
          i.status,
          i.active_from,
          i.active_to,
          i.net_weight_kg,
          i.gross_weight_kg,
          i.division,
          i.core_activity,
          i.major_group,
          i.brand_name,
          i.effective_date,
          i.customer_stock_no,
          i.stock_to_be,
          i.stock_dio_days,
          i.contract_items_for,
          i.valuation_method,
          i.item_cost,
          i.manage_stock_by_warehouse,
          i.remarks,
          i.purchase_json != null ? JSON.stringify(i.purchase_json) : null,
          i.sales_json != null ? JSON.stringify(i.sales_json) : null,
          i.inventory_json != null ? JSON.stringify(i.inventory_json) : null,
          i.planning_json != null ? JSON.stringify(i.planning_json) : null,
          i.production_json != null ? JSON.stringify(i.production_json) : null,
          i.properties_json != null ? JSON.stringify(i.properties_json) : null,
          i.attachments_json != null ? JSON.stringify(i.attachments_json) : null,
          i.metadata != null ? JSON.stringify(i.metadata) : null,
          i.is_active,
          i.created_by,
          i.created_at,
          i.updated_by,
          i.updated_at,
          dstStore,
          dstGroup,
          dstUom,
          i.image_file_asset_id,
          i.material_stage,
        );
        codeToNewId.set(String(rows[0].item_code).toUpperCase(), rows[0].item_id);
        inserted += 1;
      }
    });
  }

  // --- previous_stage_item_id second pass (by item_code) ---
  const withPrev = missing.filter((i) => i.previous_stage_item_id != null);
  let prevLinked = 0;
  if (withPrev.length) {
    const livePrevCodes = await prisma.$queryRawUnsafe(
      `
      SELECT i.item_code AS child_code, p.item_code AS prev_code
      FROM "${SRC}".items i
      JOIN "${SRC}".items p ON p.item_id = i.previous_stage_item_id
      WHERE i.company_id = $1 AND i.deleted_at IS NULL AND i.previous_stage_item_id IS NOT NULL
        AND i.item_code = ANY($2::text[])
      `,
      COMPANY_ID,
      withPrev.map((i) => i.item_code),
    );
    for (const row of livePrevCodes) {
      const childId = (
        await prisma.$queryRawUnsafe(
          `SELECT item_id FROM "${DST}".items WHERE company_id=$1 AND item_code=$2 AND deleted_at IS NULL`,
          COMPANY_ID,
          row.child_code,
        )
      )[0]?.item_id;
      const prevId = (
        await prisma.$queryRawUnsafe(
          `SELECT item_id FROM "${DST}".items WHERE company_id=$1 AND item_code=$2 AND deleted_at IS NULL`,
          COMPANY_ID,
          row.prev_code,
        )
      )[0]?.item_id;
      if (!childId || !prevId) continue;
      await prisma.$executeRawUnsafe(
        `UPDATE "${DST}".items SET previous_stage_item_id = $1, updated_at = NOW() WHERE item_id = $2`,
        prevId,
        childId,
      );
      prevLinked += 1;
    }
  }

  // --- custom field values for newly inserted (+ any active item missing CF on test) ---
  let cfInserted = 0;
  for (const [srcFieldId, dstFieldId] of cfBySrc.entries()) {
    const n = await prisma.$executeRawUnsafe(
      `
      INSERT INTO "${DST}".custom_field_values (
        company_id, entity_type, record_id, field_id,
        value_text, value_number, value_date, value_bool, value_json,
        created_at, updated_at
      )
      SELECT
        $1, 'item', dst.item_id, $2,
        v.value_text, v.value_number, v.value_date, v.value_bool, v.value_json,
        COALESCE(v.created_at, NOW()), COALESCE(v.updated_at, NOW())
      FROM "${SRC}".custom_field_values v
      JOIN "${SRC}".items src ON src.item_id = v.record_id AND src.company_id = $1 AND src.deleted_at IS NULL
      JOIN "${DST}".items dst ON dst.company_id = $1 AND dst.item_code = src.item_code AND dst.deleted_at IS NULL
      WHERE v.company_id = $1 AND v.field_id = $3 AND v.entity_type = 'item'
        AND NOT EXISTS (
          SELECT 1 FROM "${DST}".custom_field_values x
          WHERE x.field_id = $2 AND x.record_id = dst.item_id
        )
      `,
      COMPANY_ID,
      dstFieldId,
      BigInt(srcFieldId),
    );
    cfInserted += Number(n) || 0;
  }

  // --- reactivate stores that have materials ---
  await prisma.$executeRawUnsafe(
    `
    UPDATE "${DST}".store_categories sc
    SET is_active = EXISTS (
          SELECT 1 FROM "${DST}".items i
          WHERE i.store_category_id = sc.store_category_id
            AND i.company_id = sc.company_id
            AND i.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM "${DST}".machines m WHERE m.item_id = i.item_id)
        ),
        updated_at = NOW()
    WHERE sc.company_id = $1 AND sc.deleted_at IS NULL
    `,
    COMPANY_ID,
  );

  const counts = await prisma.$queryRawUnsafe(
    `
    SELECT sc.name, sc.code_prefix AS code, sc.is_active,
           COUNT(i.item_id)::int AS item_count
    FROM "${DST}".store_categories sc
    LEFT JOIN "${DST}".items i
      ON i.store_category_id = sc.store_category_id
     AND i.company_id = sc.company_id
     AND i.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM "${DST}".machines m WHERE m.item_id = i.item_id)
    WHERE sc.company_id = $1 AND sc.deleted_at IS NULL
    GROUP BY sc.store_category_id, sc.name, sc.code_prefix, sc.is_active
    ORDER BY item_count DESC, sc.name
    `,
    COMPANY_ID,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        schema: DST,
        inserted,
        prevStageLinked: prevLinked,
        customFieldValuesUpserted: cfInserted,
        groupsCreated: missingGroups.map((g) => g.name),
        skippedSoftDeletedOnTest: skipSoft,
        stores: counts,
        totalItems: counts.reduce((s, r) => s + r.item_count, 0),
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
