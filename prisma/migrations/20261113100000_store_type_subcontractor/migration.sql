-- One "Sub Contractor Store" per company (Store Type), one location per vendor inside it, and the
-- header store of an Opening Stock that points at the Sub Contractor Store.

-- Store Master: store type
ALTER TABLE "store_categories" ADD COLUMN "store_type" VARCHAR(20) NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "store_categories" ADD CONSTRAINT "store_categories_store_type_check"
  CHECK ("store_type" IN ('NORMAL', 'SUBCONTRACTOR'));
CREATE UNIQUE INDEX "store_categories_company_subcontractor_uidx"
  ON "store_categories"("company_id")
  WHERE "store_type" = 'SUBCONTRACTOR' AND "deleted_at" IS NULL;

-- One live location per vendor inside a store (safe auto-create)
CREATE UNIQUE INDEX "warehouses_store_vendor_uidx"
  ON "warehouses"("store_category_id", "vendor_id")
  WHERE "vendor_id" IS NOT NULL AND "deleted_at" IS NULL;

-- Opening Stock header "Store" when it is the Sub Contractor Store (vendor is chosen per line)
ALTER TABLE "inventory_documents" ADD COLUMN "default_store_category_id" BIGINT;
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_default_store_category_id_fkey"
  FOREIGN KEY ("default_store_category_id") REFERENCES "store_categories"("store_category_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Excel import: vendor of a Sub Contractor Store row
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "vendor_text" VARCHAR(40);
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "vendor_id" BIGINT;
ALTER TABLE "opening_stock_import_rows" ADD COLUMN "subcontract_store_id" BIGINT;

-- No data change: the Sub Contractor Store is marked through Store Master (not by name).

-- Rollback:
--   ALTER TABLE "opening_stock_import_rows" DROP COLUMN "subcontract_store_id", DROP COLUMN "vendor_id", DROP COLUMN "vendor_text";
--   ALTER TABLE "inventory_documents" DROP CONSTRAINT "inventory_documents_default_store_category_id_fkey",
--     DROP COLUMN "default_store_category_id";
--   DROP INDEX "warehouses_store_vendor_uidx";
--   DROP INDEX "store_categories_company_subcontractor_uidx";
--   ALTER TABLE "store_categories" DROP CONSTRAINT "store_categories_store_type_check", DROP COLUMN "store_type";
