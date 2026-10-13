-- Company-defined store categories (name + code prefix) for Inventory Locations.
CREATE TABLE "store_categories" (
    "store_category_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code_prefix" VARCHAR(6) NOT NULL,
    "description" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "store_categories_pkey" PRIMARY KEY ("store_category_id"),
    CONSTRAINT "store_categories_code_prefix_format" CHECK ("code_prefix" ~ '^[A-Z][A-Z0-9]{1,5}$')
);

CREATE INDEX "store_categories_company_id_idx" ON "store_categories"("company_id");
CREATE UNIQUE INDEX "store_categories_company_name_uidx"
  ON "store_categories"("company_id", lower("name")) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "store_categories_company_prefix_uidx"
  ON "store_categories"("company_id", "code_prefix") WHERE "deleted_at" IS NULL;

ALTER TABLE "store_categories" ADD CONSTRAINT "store_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "warehouses" ADD COLUMN "store_category_id" BIGINT;
CREATE INDEX "warehouses_store_category_id_idx" ON "warehouses"("store_category_id");
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_store_category_id_fkey" FOREIGN KEY ("store_category_id") REFERENCES "store_categories"("store_category_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed a) Ana Machinery: its 7 stores.
INSERT INTO "store_categories" ("company_id", "name", "code_prefix", "sort_order")
SELECT c."company_id", v.name, v.prefix, v.sort_order
FROM "companies" c
CROSS JOIN (VALUES
  ('Raw Material Store', 'RMS', 1),
  ('Spares Store', 'SPR', 2),
  ('Finished Goods Store', 'FGS', 3),
  ('Bought-Out Store', 'BOS', 4),
  ('Electrical Store', 'ELS', 5),
  ('General Store', 'GEN', 6),
  ('Oil Store', 'OIL', 7)
) AS v(name, prefix, sort_order)
WHERE c."company_id" = 28 AND c."company_code" = 'ANA_MACHINERY_P_LTD';

-- Seed b) every other company: one default General Store.
INSERT INTO "store_categories" ("company_id", "name", "code_prefix", "sort_order")
SELECT c."company_id", 'General Store', 'GEN', 1
FROM "companies" c
WHERE c."deleted_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "store_categories" s WHERE s."company_id" = c."company_id");

-- Backfill d) locations already typed as one of the 7 stores → link (create the category if missing).
INSERT INTO "store_categories" ("company_id", "name", "code_prefix", "sort_order")
SELECT DISTINCT w."company_id", m.name, m.prefix, m.sort_order
FROM "warehouses" w
JOIN (VALUES
  ('RawMaterialStore', 'Raw Material Store', 'RMS', 1),
  ('SparesStore', 'Spares Store', 'SPR', 2),
  ('FinishedGoodsStore', 'Finished Goods Store', 'FGS', 3),
  ('BoughtOutStore', 'Bought-Out Store', 'BOS', 4),
  ('ElectricalStore', 'Electrical Store', 'ELS', 5),
  ('GeneralStore', 'General Store', 'GEN', 6),
  ('OilStore', 'Oil Store', 'OIL', 7)
) AS m(location_type, name, prefix, sort_order) ON m.location_type = w."location_type"::text
WHERE NOT EXISTS (
  SELECT 1 FROM "store_categories" s
  WHERE s."company_id" = w."company_id" AND s."deleted_at" IS NULL
    AND (s."code_prefix" = m.prefix OR lower(s."name") = lower(m.name))
);

UPDATE "warehouses" w
SET "store_category_id" = s."store_category_id"
FROM (VALUES
  ('RawMaterialStore', 'RMS'), ('SparesStore', 'SPR'), ('FinishedGoodsStore', 'FGS'),
  ('BoughtOutStore', 'BOS'), ('ElectricalStore', 'ELS'), ('GeneralStore', 'GEN'), ('OilStore', 'OIL')
) AS m(location_type, prefix), "store_categories" s
WHERE m.location_type = w."location_type"::text
  AND s."company_id" = w."company_id" AND s."code_prefix" = m.prefix AND s."deleted_at" IS NULL
  AND w."store_category_id" IS NULL;
