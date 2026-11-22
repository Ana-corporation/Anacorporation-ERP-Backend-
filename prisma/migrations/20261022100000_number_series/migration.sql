-- Number series: auto-generated Item part numbers per store category (e.g. ANABO00001).
-- No company data is seeded here; see scripts/seed-number-series-ana.ts.

-- CreateEnum
CREATE TYPE "number_series_document_type" AS ENUM ('ITEM');

-- CreateEnum
CREATE TYPE "number_series_segment_source" AS ENUM ('STORE', 'ITEM_GROUP', 'NONE');

-- CreateEnum
CREATE TYPE "number_series_separator" AS ENUM ('NONE', 'HYPHEN', 'SLASH');

-- CreateEnum
CREATE TYPE "number_series_reset" AS ENUM ('NEVER', 'YEARLY');

-- CreateTable
CREATE TABLE "number_series_configs" (
    "number_series_config_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "document_type" "number_series_document_type" NOT NULL,
    "prefix" VARCHAR(10) NOT NULL DEFAULT '',
    "segment_source" "number_series_segment_source" NOT NULL DEFAULT 'STORE',
    "separator" "number_series_separator" NOT NULL DEFAULT 'NONE',
    "serial_length_default" INTEGER NOT NULL DEFAULT 5,
    "serial_reset" "number_series_reset" NOT NULL DEFAULT 'NEVER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "number_series_configs_pkey" PRIMARY KEY ("number_series_config_id"),
    CONSTRAINT "number_series_configs_prefix_format" CHECK ("prefix" ~ '^[A-Z0-9]{0,10}$'),
    CONSTRAINT "number_series_configs_serial_length_range" CHECK ("serial_length_default" BETWEEN 3 AND 8)
);

-- CreateTable
CREATE TABLE "number_series_lines" (
    "number_series_line_id" BIGSERIAL NOT NULL,
    "number_series_config_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "segment_ref_id" BIGINT,
    "segment_code" VARCHAR(6) NOT NULL DEFAULT '',
    "start_from" INTEGER NOT NULL DEFAULT 1,
    "serial_length" INTEGER NOT NULL DEFAULT 5,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "number_series_lines_pkey" PRIMARY KEY ("number_series_line_id"),
    CONSTRAINT "number_series_lines_segment_code_format" CHECK ("segment_code" ~ '^[A-Z0-9]{0,6}$'),
    CONSTRAINT "number_series_lines_serial_length_range" CHECK ("serial_length" BETWEEN 3 AND 8),
    CONSTRAINT "number_series_lines_start_from_min" CHECK ("start_from" >= 1),
    CONSTRAINT "number_series_lines_last_number_min" CHECK ("last_number" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "number_series_configs_company_id_document_type_key" ON "number_series_configs"("company_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "number_series_lines_number_series_config_id_segment_code_key" ON "number_series_lines"("number_series_config_id", "segment_code");

-- CreateIndex
CREATE UNIQUE INDEX "number_series_lines_number_series_config_id_segment_ref_id_key" ON "number_series_lines"("number_series_config_id", "segment_ref_id");

-- CreateIndex
CREATE INDEX "number_series_lines_company_id_idx" ON "number_series_lines"("company_id");

-- AddForeignKey
ALTER TABLE "number_series_configs" ADD CONSTRAINT "number_series_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_series_lines" ADD CONSTRAINT "number_series_lines_number_series_config_id_fkey" FOREIGN KEY ("number_series_config_id") REFERENCES "number_series_configs"("number_series_config_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_series_lines" ADD CONSTRAINT "number_series_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Store category: short part-number segment code (RM, BO, ...), unique per company among live rows.
ALTER TABLE "store_categories" ADD COLUMN "number_series_code" VARCHAR(6);
ALTER TABLE "store_categories" ADD CONSTRAINT "store_categories_number_series_code_format"
  CHECK ("number_series_code" IS NULL OR "number_series_code" ~ '^[A-Z0-9]{1,6}$');
CREATE UNIQUE INDEX "store_categories_company_number_series_code_uidx"
  ON "store_categories"("company_id", "number_series_code")
  WHERE "deleted_at" IS NULL AND "number_series_code" IS NOT NULL;

-- Item: store category (nullable so existing items stay valid).
ALTER TABLE "items" ADD COLUMN "store_category_id" BIGINT;
CREATE INDEX "items_company_id_store_category_id_idx" ON "items"("company_id", "store_category_id");
ALTER TABLE "items" ADD CONSTRAINT "items_store_category_id_fkey" FOREIGN KEY ("store_category_id") REFERENCES "store_categories"("store_category_id") ON DELETE SET NULL ON UPDATE CASCADE;
