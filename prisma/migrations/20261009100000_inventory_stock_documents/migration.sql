-- Initial inventory: Opening Stock, Material Issue, Stock Adjustment, Current Stock, Stock Ledger

-- CreateEnum
CREATE TYPE "inventory_document_type" AS ENUM ('OPENING_STOCK', 'MATERIAL_ISSUE', 'STOCK_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "inventory_document_status" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('OPENING_STOCK', 'MATERIAL_ISSUE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateTable
CREATE TABLE "inventory_documents" (
    "document_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "document_type" "inventory_document_type" NOT NULL,
    "document_number" VARCHAR(30) NOT NULL,
    "document_date" DATE NOT NULL,
    "status" "inventory_document_status" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "requested_by" VARCHAR(150),
    "issued_by" VARCHAR(150),
    "department_id" BIGINT,
    "purpose" VARCHAR(255),
    "reason" VARCHAR(255),
    "posted_at" TIMESTAMP(3),
    "posted_by" BIGINT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "inventory_document_lines" (
    "line_id" BIGSERIAL NOT NULL,
    "document_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "warehouse_id" BIGINT NOT NULL,
    "storage_bin_id" BIGINT,
    "uom" VARCHAR(40),
    "quantity" DECIMAL(18,6),
    "unit_price" DECIMAL(18,6),
    "system_quantity" DECIMAL(18,6),
    "physical_quantity" DECIMAL(18,6),
    "difference" DECIMAL(18,6),
    "remarks" VARCHAR(255),

    CONSTRAINT "inventory_document_lines_pkey" PRIMARY KEY ("line_id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "stock_balance_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "warehouse_id" BIGINT NOT NULL,
    "storage_bin_id" BIGINT,
    "bin_key" BIGINT NOT NULL DEFAULT 0,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("stock_balance_id"),
    CONSTRAINT "stock_balances_quantity_non_negative" CHECK ("quantity" >= 0)
);

-- CreateTable
CREATE TABLE "stock_ledger_entries" (
    "entry_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "movement_type" "stock_movement_type" NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_line_id" BIGINT NOT NULL,
    "document_id" BIGINT,
    "document_number" VARCHAR(30) NOT NULL,
    "item_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "warehouse_id" BIGINT NOT NULL,
    "storage_bin_id" BIGINT,
    "qty_in" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "qty_out" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "uom" VARCHAR(40),
    "unit_cost" DECIMAL(18,6),
    "total_value" DECIMAL(18,6),
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_entries_pkey" PRIMARY KEY ("entry_id"),
    CONSTRAINT "stock_ledger_entries_one_direction" CHECK (
        "qty_in" >= 0 AND "qty_out" >= 0 AND ("qty_in" = 0 OR "qty_out" = 0)
    )
);

-- CreateIndex
CREATE INDEX "inventory_documents_company_id_document_type_status_idx" ON "inventory_documents"("company_id", "document_type", "status");

-- CreateIndex
CREATE INDEX "inventory_documents_company_id_document_date_idx" ON "inventory_documents"("company_id", "document_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_documents_company_id_document_type_document_numbe_key" ON "inventory_documents"("company_id", "document_type", "document_number");

-- CreateIndex
CREATE INDEX "inventory_document_lines_company_id_item_id_idx" ON "inventory_document_lines"("company_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_document_lines_document_id_line_no_key" ON "inventory_document_lines"("document_id", "line_no");

-- CreateIndex
CREATE INDEX "stock_balances_company_id_warehouse_id_idx" ON "stock_balances"("company_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_company_id_item_id_warehouse_id_bin_key_key" ON "stock_balances"("company_id", "item_id", "warehouse_id", "bin_key");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_company_id_item_id_transaction_date_idx" ON "stock_ledger_entries"("company_id", "item_id", "transaction_date");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_company_id_warehouse_id_transaction_da_idx" ON "stock_ledger_entries"("company_id", "warehouse_id", "transaction_date");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_company_id_document_number_idx" ON "stock_ledger_entries"("company_id", "document_number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_ledger_entries_source_type_source_line_id_movement_ty_key" ON "stock_ledger_entries"("source_type", "source_line_id", "movement_type");

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_storage_bin_id_fkey" FOREIGN KEY ("storage_bin_id") REFERENCES "storage_bins"("storage_bin_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_storage_bin_id_fkey" FOREIGN KEY ("storage_bin_id") REFERENCES "storage_bins"("storage_bin_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("document_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_storage_bin_id_fkey" FOREIGN KEY ("storage_bin_id") REFERENCES "storage_bins"("storage_bin_id") ON DELETE NO ACTION ON UPDATE CASCADE;
