-- Opening Stock phase 1: document totals / default store / attachments, line batch / serial /
-- total / zero-price flag, vendor-held locations, category switch for new items from opening
-- stock, and review fields on import rows. Stock keys (item + location + bin) are unchanged.

-- Documents
ALTER TABLE "inventory_documents" ADD COLUMN "default_warehouse_id" BIGINT;
ALTER TABLE "inventory_documents" ADD COLUMN "total_lines" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "inventory_documents" ADD COLUMN "total_quantity" DECIMAL(20,6) NOT NULL DEFAULT 0;
ALTER TABLE "inventory_documents" ADD COLUMN "total_value" DECIMAL(20,6) NOT NULL DEFAULT 0;
ALTER TABLE "inventory_documents" ADD COLUMN "attachments_json" JSONB;
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_default_warehouse_id_fkey"
  FOREIGN KEY ("default_warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Lines
ALTER TABLE "inventory_document_lines" ADD COLUMN "batch_no" VARCHAR(60);
ALTER TABLE "inventory_document_lines" ADD COLUMN "serial_no" VARCHAR(80);
ALTER TABLE "inventory_document_lines" ADD COLUMN "line_total" DECIMAL(20,6);
ALTER TABLE "inventory_document_lines" ADD COLUMN "zero_price_confirmed" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "inventory_document_lines_company_item_serial_idx"
  ON "inventory_document_lines"("company_id", "item_id", "serial_no") WHERE "serial_no" IS NOT NULL;

UPDATE "inventory_document_lines"
SET "line_total" = ROUND("quantity" * COALESCE("unit_price", 0), 6)
WHERE "quantity" IS NOT NULL;

UPDATE "inventory_documents" d
SET "total_lines" = s.n, "total_quantity" = s.qty, "total_value" = s.value
FROM (
  SELECT "document_id", COUNT(*)::int AS n,
         COALESCE(SUM(COALESCE("quantity", "physical_quantity")), 0) AS qty,
         COALESCE(SUM("line_total"), 0) AS value
  FROM "inventory_document_lines" GROUP BY "document_id"
) s
WHERE d."document_id" = s."document_id";

-- Vendor-held (sub-contractor) locations
ALTER TABLE "warehouses" ADD COLUMN "vendor_id" BIGINT;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "warehouses_vendor_id_idx" ON "warehouses"("vendor_id");

-- Categories that may get new items from an Opening Stock import.
-- New categories: off. Existing ones keep today's behaviour, except categories that already
-- hold semi-finished / finished stage items (those are made, never created by opening stock).
ALTER TABLE "item_groups" ADD COLUMN "allow_opening_create" BOOLEAN NOT NULL DEFAULT false;
UPDATE "item_groups" g SET "allow_opening_create" = true
WHERE g."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "items" i
    WHERE i."item_group_id" = g."item_group_id" AND i."material_stage" IN ('SF', 'FF')
  );

-- Import review
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "bin_text" VARCHAR(40);
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "batch_no" VARCHAR(60);
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "serial_no" VARCHAR(80);
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "remarks" VARCHAR(255);
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "new_item_confirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "similar_items" JSONB;

-- Rollback:
--   ALTER TABLE "opening_stock_import_rows" DROP COLUMN "similar_items", DROP COLUMN "excluded",
--     DROP COLUMN "new_item_confirmed", DROP COLUMN "remarks", DROP COLUMN "serial_no",
--     DROP COLUMN "batch_no", DROP COLUMN "bin_text";
--   ALTER TABLE "item_groups" DROP COLUMN "allow_opening_create";
--   DROP INDEX "warehouses_vendor_id_idx";
--   ALTER TABLE "warehouses" DROP CONSTRAINT "warehouses_vendor_id_fkey", DROP COLUMN "vendor_id";
--   DROP INDEX "inventory_document_lines_company_item_serial_idx";
--   ALTER TABLE "inventory_document_lines" DROP COLUMN "zero_price_confirmed", DROP COLUMN "line_total",
--     DROP COLUMN "serial_no", DROP COLUMN "batch_no";
--   ALTER TABLE "inventory_documents" DROP CONSTRAINT "inventory_documents_default_warehouse_id_fkey",
--     DROP COLUMN "attachments_json", DROP COLUMN "total_value", DROP COLUMN "total_quantity",
--     DROP COLUMN "total_lines", DROP COLUMN "default_warehouse_id";
