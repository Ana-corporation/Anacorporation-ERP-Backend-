-- BOM module (phase 2): one BOM header per version, MAIN / SUB lines grouped by a backend Common Key,
-- status history, Number Series document type BOM. No company data is seeded here.
-- DEV (Erp_test_db) first; LIVE (Ana_corporation_db) only with approval.
--
-- Rollback (manual):
--   DROP TABLE "bom_status_history"; DROP TABLE "bom_lines"; DROP TABLE "boms";
--   DROP TYPE "bom_source_type"; DROP TYPE "bom_line_type"; DROP TYPE "bom_status";
--   DROP TYPE "bom_scope"; DROP TYPE "bom_type";
--   The enum value number_series_document_type 'BOM' stays (dropping an enum value needs a type
--   rebuild); delete any number_series_configs row with document_type 'BOM' first if needed.

-- AlterEnum (value not used inside this migration, so this is transaction-safe)
ALTER TYPE "number_series_document_type" ADD VALUE 'BOM';

-- CreateEnum
CREATE TYPE "bom_type" AS ENUM ('ENGINEERING', 'MANUFACTURING');
CREATE TYPE "bom_scope" AS ENUM ('STANDARD', 'CUSTOMER');
CREATE TYPE "bom_status" AS ENUM ('DRAFT', 'RELEASED', 'OBSOLETE', 'CANCELLED');
CREATE TYPE "bom_line_type" AS ENUM ('MAIN', 'SUB');
CREATE TYPE "bom_source_type" AS ENUM ('MANUAL', 'SOLIDWORKS_IMPORT', 'COPY_FROM_EBOM', 'COPY', 'CUSTOMER_COPY');

-- CreateTable
CREATE TABLE "boms" (
    "bom_id" BIGSERIAL NOT NULL,
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" BIGINT NOT NULL,
    "bom_number" VARCHAR(40) NOT NULL,
    "parent_item_id" BIGINT NOT NULL,
    "bom_type" "bom_type" NOT NULL,
    "bom_scope" "bom_scope" NOT NULL DEFAULT 'STANDARD',
    "base_quantity" DECIMAL(19,6) NOT NULL DEFAULT 1,
    "uom_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision_label" VARCHAR(10),
    "revision_reason" TEXT,
    "root_bom_id" BIGINT,
    "previous_version_id" BIGINT,
    "is_current_version" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "bom_status" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE,
    "effective_to" DATE,
    "next_common_key" INTEGER NOT NULL DEFAULT 1,
    "source_type" "bom_source_type" NOT NULL DEFAULT 'MANUAL',
    "source_id" BIGINT,
    "base_bom_id" BIGINT,
    "base_version_no" INTEGER,
    "customer_id" BIGINT,
    "source_document_type" VARCHAR(40),
    "source_document_id" BIGINT,
    "customization_notes" TEXT,
    "remarks" TEXT,
    "released_at" TIMESTAMP(3),
    "released_by" BIGINT,
    "obsoleted_at" TIMESTAMP(3),
    "obsolete_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "boms_pkey" PRIMARY KEY ("bom_id"),
    CONSTRAINT "boms_base_quantity_positive" CHECK ("base_quantity" > 0),
    CONSTRAINT "boms_version_min" CHECK ("version" >= 1),
    CONSTRAINT "boms_next_common_key_min" CHECK ("next_common_key" >= 1),
    CONSTRAINT "boms_effective_range" CHECK ("effective_from" IS NULL OR "effective_to" IS NULL OR "effective_from" <= "effective_to"),
    CONSTRAINT "boms_revision_reason_required" CHECK ("version" = 1 OR ("revision_reason" IS NOT NULL AND btrim("revision_reason") <> '')),
    CONSTRAINT "boms_default_standard_only" CHECK (NOT "is_default" OR "bom_scope" = 'STANDARD')
);

-- CreateTable
CREATE TABLE "bom_lines" (
    "bom_line_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "bom_id" BIGINT NOT NULL,
    "line_type" "bom_line_type" NOT NULL,
    "common_key" VARCHAR(20) NOT NULL,
    "parent_line_id" BIGINT,
    "component_item_id" BIGINT NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "uom_id" BIGINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "find_number" VARCHAR(20),
    "scrap_percentage" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "remarks" VARCHAR(500),
    "item_code_snapshot" VARCHAR(50),
    "item_name_snapshot" VARCHAR(255),
    "uom_code_snapshot" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("bom_line_id"),
    CONSTRAINT "bom_lines_main_sub_parent" CHECK (
        ("line_type" = 'MAIN' AND "parent_line_id" IS NULL)
        OR ("line_type" = 'SUB' AND "parent_line_id" IS NOT NULL)
    ),
    CONSTRAINT "bom_lines_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "bom_lines_scrap_range" CHECK ("scrap_percentage" >= 0 AND "scrap_percentage" <= 100),
    CONSTRAINT "bom_lines_common_key_not_blank" CHECK (btrim("common_key") <> '')
);

-- CreateTable
CREATE TABLE "bom_status_history" (
    "bom_status_history_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "bom_id" BIGINT NOT NULL,
    "from_status" "bom_status",
    "to_status" "bom_status" NOT NULL,
    "actor_id" BIGINT,
    "reason" TEXT,
    "idempotency_key" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_status_history_pkey" PRIMARY KEY ("bom_status_history_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boms_uuid_key" ON "boms"("uuid");
CREATE UNIQUE INDEX "boms_company_id_bom_number_version_key" ON "boms"("company_id", "bom_number", "version");
CREATE INDEX "boms_company_id_parent_item_id_idx" ON "boms"("company_id", "parent_item_id");
CREATE INDEX "boms_company_id_status_idx" ON "boms"("company_id", "status");
CREATE INDEX "boms_company_id_root_bom_id_idx" ON "boms"("company_id", "root_bom_id");
CREATE INDEX "boms_company_id_base_bom_id_idx" ON "boms"("company_id", "base_bom_id");

-- One RELEASED current STANDARD BOM per parent item + type (customer BOMs not covered)
CREATE UNIQUE INDEX "boms_one_current_release_uidx"
  ON "boms"("company_id", "parent_item_id", "bom_type")
  WHERE "status" = 'RELEASED' AND "is_current_version" AND "bom_scope" = 'STANDARD' AND "deleted_at" IS NULL;

-- Only one DRAFT per BOM (root) at a time
CREATE UNIQUE INDEX "boms_one_draft_per_root_uidx"
  ON "boms"("company_id", "root_bom_id")
  WHERE "status" = 'DRAFT' AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "bom_lines_bom_id_line_number_key" ON "bom_lines"("bom_id", "line_number");
CREATE INDEX "bom_lines_company_id_component_item_id_idx" ON "bom_lines"("company_id", "component_item_id");
CREATE INDEX "bom_lines_bom_id_parent_line_id_idx" ON "bom_lines"("bom_id", "parent_line_id");

-- One MAIN per Common Key within a BOM (final guard for concurrent key allocation)
CREATE UNIQUE INDEX "bom_lines_one_main_per_key_uidx"
  ON "bom_lines"("bom_id", "common_key")
  WHERE "line_type" = 'MAIN';

CREATE INDEX "bom_status_history_company_id_bom_id_idx" ON "bom_status_history"("company_id", "bom_id");

-- AddForeignKey
ALTER TABLE "boms" ADD CONSTRAINT "boms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "items"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "uoms"("uom_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_root_bom_id_fkey" FOREIGN KEY ("root_bom_id") REFERENCES "boms"("bom_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "boms"("bom_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_base_bom_id_fkey" FOREIGN KEY ("base_bom_id") REFERENCES "boms"("bom_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("bom_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_parent_line_id_fkey" FOREIGN KEY ("parent_line_id") REFERENCES "bom_lines"("bom_line_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_component_item_id_fkey" FOREIGN KEY ("component_item_id") REFERENCES "items"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "uoms"("uom_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bom_status_history" ADD CONSTRAINT "bom_status_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_status_history" ADD CONSTRAINT "bom_status_history_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("bom_id") ON DELETE CASCADE ON UPDATE CASCADE;
