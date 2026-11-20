-- Machine master: machines (BASE models like BS500; ORDER = customised for one sales order, e.g.
-- BS500-SO00045) each linked to one Item Master item, plus per-company machine_settings (which
-- category / UOM machine items use). No company data is seeded here.
-- DEV (Erp_test_db) first; LIVE (Ana_corporation_db) only with approval.
--
-- Rollback (manual):
--   DROP TABLE "machine_settings"; DROP TABLE "machines";
--   DROP TYPE "machine_status"; DROP TYPE "machine_type";
--   Items created for machines stay (they are normal items).

-- CreateEnum
CREATE TYPE "machine_type" AS ENUM ('BASE', 'ORDER');
CREATE TYPE "machine_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "machines" (
    "machine_id" BIGSERIAL NOT NULL,
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" BIGINT NOT NULL,
    "machine_code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "series" VARCHAR(20),
    "model" VARCHAR(40),
    "description" TEXT,
    "remarks" TEXT,
    "image_file_asset_id" UUID,
    "machine_type" "machine_type" NOT NULL DEFAULT 'BASE',
    "status" "machine_status" NOT NULL DEFAULT 'ACTIVE',
    "item_id" BIGINT NOT NULL,
    "base_machine_id" BIGINT,
    "sales_order_no" VARCHAR(20),
    "sales_order_id" BIGINT,
    "customer_id" BIGINT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("machine_id"),
    CONSTRAINT "machines_code_format" CHECK ("machine_code" ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
    CONSTRAINT "machines_type_shape" CHECK (
        ("machine_type" = 'BASE' AND "base_machine_id" IS NULL AND "sales_order_no" IS NULL)
        OR ("machine_type" = 'ORDER' AND "base_machine_id" IS NOT NULL AND "sales_order_no" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "machine_settings" (
    "company_id" BIGINT NOT NULL,
    "item_group_id" BIGINT NOT NULL,
    "uom_id" BIGINT NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "machine_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "machines_uuid_key" ON "machines"("uuid");
CREATE UNIQUE INDEX "machines_item_id_key" ON "machines"("item_id");
CREATE UNIQUE INDEX "machines_company_id_machine_code_key" ON "machines"("company_id", "machine_code");
CREATE INDEX "machines_company_id_status_idx" ON "machines"("company_id", "status");
CREATE INDEX "machines_company_id_base_machine_id_idx" ON "machines"("company_id", "base_machine_id");
CREATE INDEX "machines_company_id_customer_id_idx" ON "machines"("company_id", "customer_id");

-- One customised machine per base machine + sales order
CREATE UNIQUE INDEX "machines_one_variant_per_order_uidx"
  ON "machines"("company_id", "base_machine_id", "sales_order_no")
  WHERE "machine_type" = 'ORDER' AND "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "machines" ADD CONSTRAINT "machines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machines" ADD CONSTRAINT "machines_base_machine_id_fkey" FOREIGN KEY ("base_machine_id") REFERENCES "machines"("machine_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "machines" ADD CONSTRAINT "machines_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "machine_settings" ADD CONSTRAINT "machine_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "machine_settings" ADD CONSTRAINT "machine_settings_item_group_id_fkey" FOREIGN KEY ("item_group_id") REFERENCES "item_groups"("item_group_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_settings" ADD CONSTRAINT "machine_settings_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "uoms"("uom_id") ON DELETE RESTRICT ON UPDATE CASCADE;
