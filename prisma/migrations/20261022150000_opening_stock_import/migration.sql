-- Opening stock import: batches + rows, and reference columns on inventory document lines.

-- CreateEnum
CREATE TYPE "opening_stock_import_status" AS ENUM ('DRAFT', 'VALIDATED', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "opening_stock_import_match" AS ENUM ('MATCHED', 'NEW', 'ERROR');

-- CreateTable
CREATE TABLE "opening_stock_import_batches" (
    "batch_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "status" "opening_stock_import_status" NOT NULL DEFAULT 'DRAFT',
    "document_date" DATE NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "matched_rows" INTEGER NOT NULL DEFAULT 0,
    "new_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "total_value" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "document_id" BIGINT,
    "error_message" TEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "approved_by" BIGINT,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "opening_stock_import_batches_pkey" PRIMARY KEY ("batch_id")
);

-- CreateTable
CREATE TABLE "opening_stock_import_rows" (
    "row_id" BIGSERIAL NOT NULL,
    "batch_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "row_no" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "store_text" VARCHAR(100),
    "store_category_id" BIGINT,
    "part_number" VARCHAR(50),
    "part_name" VARCHAR(255),
    "part_code" VARCHAR(80),
    "material_grade" VARCHAR(80),
    "size" VARCHAR(80),
    "uom_text" VARCHAR(40),
    "uom_id" BIGINT,
    "status_text" VARCHAR(20),
    "location_code" VARCHAR(80),
    "warehouse_id" BIGINT,
    "storage_bin_id" BIGINT,
    "quantity" DECIMAL(18,6),
    "unit_price" DECIMAL(18,6),
    "revision" VARCHAR(40),
    "machine_model" VARCHAR(120),
    "machine_no" VARCHAR(120),
    "category" VARCHAR(120),
    "match_status" "opening_stock_import_match" NOT NULL DEFAULT 'ERROR',
    "matched_item_id" BIGINT,
    "candidate_item_ids" JSONB,
    "item_group_id" BIGINT,
    "error_messages" JSONB NOT NULL DEFAULT '[]',
    "created_item_id" BIGINT,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "opening_stock_import_rows_pkey" PRIMARY KEY ("row_id")
);

-- CreateIndex
CREATE INDEX "opening_stock_import_batches_company_id_created_at_idx" ON "opening_stock_import_batches"("company_id", "created_at");
CREATE INDEX "opening_stock_import_batches_company_id_file_hash_idx" ON "opening_stock_import_batches"("company_id", "file_hash");
CREATE UNIQUE INDEX "opening_stock_import_rows_batch_id_row_no_key" ON "opening_stock_import_rows"("batch_id", "row_no");
CREATE INDEX "opening_stock_import_rows_batch_id_match_status_idx" ON "opening_stock_import_rows"("batch_id", "match_status");
CREATE INDEX "opening_stock_import_rows_company_id_part_code_idx" ON "opening_stock_import_rows"("company_id", "part_code");

-- AddForeignKey
ALTER TABLE "opening_stock_import_batches" ADD CONSTRAINT "opening_stock_import_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_stock_import_batches" ADD CONSTRAINT "opening_stock_import_batches_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("document_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "opening_stock_import_rows" ADD CONSTRAINT "opening_stock_import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "opening_stock_import_batches"("batch_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Inventory document lines: reference text from the import (not on Item Master).
ALTER TABLE "inventory_document_lines" ADD COLUMN "revision" VARCHAR(40);
ALTER TABLE "inventory_document_lines" ADD COLUMN "part_code" VARCHAR(80);
ALTER TABLE "inventory_document_lines" ADD COLUMN "material_grade" VARCHAR(80);
ALTER TABLE "inventory_document_lines" ADD COLUMN "size" VARCHAR(80);
