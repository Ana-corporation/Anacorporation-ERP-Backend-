-- Inventory Phase 1A: warehouse location fields + storage_bins

CREATE TYPE "warehouse_location_type" AS ENUM ('Warehouse', 'Store', 'Godown', 'Other');

ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "location_type" "warehouse_location_type" NOT NULL DEFAULT 'Store',
  ADD COLUMN IF NOT EXISTS "bin_management" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "storage_bins" (
  "storage_bin_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "bin_code" VARCHAR(50) NOT NULL,
  "bin_name" VARCHAR(150),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" BIGINT,
  "updated_at" TIMESTAMP(3),
  "deleted_by" BIGINT,
  "deleted_at" TIMESTAMP(3),
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "storage_bins_pkey" PRIMARY KEY ("storage_bin_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "storage_bins_warehouse_id_bin_code_key"
  ON "storage_bins" ("warehouse_id", "bin_code");

CREATE INDEX IF NOT EXISTS "storage_bins_company_id_idx"
  ON "storage_bins" ("company_id");

CREATE INDEX IF NOT EXISTS "storage_bins_warehouse_id_idx"
  ON "storage_bins" ("warehouse_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storage_bins_company_id_fkey'
  ) THEN
    ALTER TABLE "storage_bins"
      ADD CONSTRAINT "storage_bins_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("company_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'storage_bins_warehouse_id_fkey'
  ) THEN
    ALTER TABLE "storage_bins"
      ADD CONSTRAINT "storage_bins_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
