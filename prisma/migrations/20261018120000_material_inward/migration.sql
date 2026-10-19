-- Material inward: PO rollup, GRN, QC, supplier case, return, put-away, ledger, invoice match.

CREATE TABLE "mi_purchase_orders" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "po_no" VARCHAR(30) NOT NULL,
  "po_type" VARCHAR(20) NOT NULL DEFAULT 'MATERIAL',
  "po_date" DATE NOT NULL,
  "supplier_id" BIGINT NOT NULL,
  "buyer_id" BIGINT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "remarks" VARCHAR(1000),
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" BIGINT,
  "updated_at" TIMESTAMP(3),
  "row_version" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "mi_purchase_orders_company_id_po_no_key" ON "mi_purchase_orders"("company_id", "po_no");
CREATE INDEX "mi_purchase_orders_company_id_status_idx" ON "mi_purchase_orders"("company_id", "status");
ALTER TABLE "mi_purchase_orders" ADD CONSTRAINT "mi_purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
ALTER TABLE "mi_purchase_orders" ADD CONSTRAINT "mi_purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "vendors"("vendor_id");

CREATE TABLE "mi_purchase_order_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "po_id" BIGINT NOT NULL,
  "line_no" INTEGER NOT NULL,
  "item_id" BIGINT NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "order_qty" DECIMAL(18,4) NOT NULL,
  "uom_code" VARCHAR(10) NOT NULL DEFAULT 'PCS',
  "unit_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "tax_pct" DECIMAL(8,3) NOT NULL DEFAULT 0,
  "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "rejected_open_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "returned_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "invoiced_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "short_closed_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "outstanding_qty" DECIMAL(18,4) NOT NULL,
  "qc_required" BOOLEAN NOT NULL DEFAULT TRUE,
  "batch_controlled" BOOLEAN NOT NULL DEFAULT FALSE,
  "serial_controlled" BOOLEAN NOT NULL DEFAULT FALSE,
  "line_status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "mi_purchase_order_lines_po_id_line_no_key" ON "mi_purchase_order_lines"("po_id", "line_no");
CREATE INDEX "mi_purchase_order_lines_po_id_item_id_idx" ON "mi_purchase_order_lines"("po_id", "item_id");
ALTER TABLE "mi_purchase_order_lines" ADD CONSTRAINT "mi_purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "mi_purchase_orders"("id") ON DELETE CASCADE;
ALTER TABLE "mi_purchase_order_lines" ADD CONSTRAINT "mi_purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id");
ALTER TABLE "mi_purchase_order_lines" ADD CONSTRAINT "mi_purchase_order_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id");

CREATE TABLE "mi_storage_locations" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "parent_location_id" BIGINT,
  "location_type" VARCHAR(20) NOT NULL,
  "location_code" VARCHAR(30) NOT NULL,
  "location_name" VARCHAR(120) NOT NULL,
  "is_receiving_dock" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_quarantine" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_scrap" BOOLEAN NOT NULL DEFAULT FALSE,
  "barcode" VARCHAR(80),
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "mi_storage_locations_company_wh_code_key" ON "mi_storage_locations"("company_id", "warehouse_id", "location_code");
ALTER TABLE "mi_storage_locations" ADD CONSTRAINT "mi_storage_locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id");

CREATE TABLE "mi_grn_headers" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "grn_no" VARCHAR(30) NOT NULL,
  "receipt_type" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  "po_id" BIGINT NOT NULL,
  "supplier_id" BIGINT NOT NULL,
  "supplier_do_no" VARCHAR(40),
  "delivery_date" DATE,
  "warehouse_id" BIGINT NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "packaging_condition" VARCHAR(20),
  "remarks" VARCHAR(1000),
  "parent_grn_id" BIGINT,
  "supplier_case_id" BIGINT,
  "supplier_case_line_id" BIGINT,
  "reversal_of_grn_id" BIGINT,
  "received_by" BIGINT,
  "submitted_at" TIMESTAMP(3),
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" BIGINT,
  "updated_at" TIMESTAMP(3),
  "row_version" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "mi_grn_headers_company_id_grn_no_key" ON "mi_grn_headers"("company_id", "grn_no");
CREATE INDEX "mi_grn_headers_po_id_status_idx" ON "mi_grn_headers"("po_id", "status");
CREATE INDEX "mi_grn_headers_company_id_status_idx" ON "mi_grn_headers"("company_id", "status");
ALTER TABLE "mi_grn_headers" ADD CONSTRAINT "mi_grn_headers_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "mi_purchase_orders"("id");
ALTER TABLE "mi_grn_headers" ADD CONSTRAINT "mi_grn_headers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "vendors"("vendor_id");
ALTER TABLE "mi_grn_headers" ADD CONSTRAINT "mi_grn_headers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id");

CREATE TABLE "mi_grn_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "grn_id" BIGINT NOT NULL,
  "line_no" INTEGER NOT NULL,
  "po_line_id" BIGINT NOT NULL,
  "item_id" BIGINT NOT NULL,
  "order_qty_snapshot" DECIMAL(18,4) NOT NULL,
  "prev_received_qty_snapshot" DECIMAL(18,4) NOT NULL,
  "outstanding_qty_snapshot" DECIMAL(18,4) NOT NULL,
  "received_qty" DECIMAL(18,4) NOT NULL,
  "uom_code" VARCHAR(10) NOT NULL,
  "received_qty_inv" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "excess_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "short_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "excess_status" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "inspected_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "rejected_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "conditional_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "putaway_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "returned_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "remarks" VARCHAR(500)
);
CREATE INDEX "mi_grn_lines_po_line_id_idx" ON "mi_grn_lines"("po_line_id");
CREATE INDEX "mi_grn_lines_grn_id_idx" ON "mi_grn_lines"("grn_id");
ALTER TABLE "mi_grn_lines" ADD CONSTRAINT "mi_grn_lines_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "mi_grn_headers"("id") ON DELETE CASCADE;
ALTER TABLE "mi_grn_lines" ADD CONSTRAINT "mi_grn_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "mi_purchase_order_lines"("id");

CREATE TABLE "mi_grn_batches" (
  "id" BIGSERIAL PRIMARY KEY,
  "grn_line_id" BIGINT NOT NULL,
  "batch_no" VARCHAR(40) NOT NULL,
  "supplier_batch_no" VARCHAR(40),
  "mfg_date" DATE,
  "expiry_date" DATE,
  "qty_inv" DECIMAL(18,4) NOT NULL,
  "accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "rejected_qty" DECIMAL(18,4) NOT NULL DEFAULT 0
);
CREATE INDEX "mi_grn_batches_grn_line_id_idx" ON "mi_grn_batches"("grn_line_id");
ALTER TABLE "mi_grn_batches" ADD CONSTRAINT "mi_grn_batches_grn_line_id_fkey" FOREIGN KEY ("grn_line_id") REFERENCES "mi_grn_lines"("id") ON DELETE CASCADE;

CREATE TABLE "mi_grn_serials" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "grn_line_id" BIGINT NOT NULL,
  "grn_batch_id" BIGINT,
  "item_id" BIGINT NOT NULL,
  "serial_no" VARCHAR(60) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
);
CREATE UNIQUE INDEX "mi_grn_serials_company_item_serial_key" ON "mi_grn_serials"("company_id", "item_id", "serial_no");
CREATE INDEX "mi_grn_serials_grn_line_id_idx" ON "mi_grn_serials"("grn_line_id");
ALTER TABLE "mi_grn_serials" ADD CONSTRAINT "mi_grn_serials_grn_line_id_fkey" FOREIGN KEY ("grn_line_id") REFERENCES "mi_grn_lines"("id") ON DELETE CASCADE;

CREATE TABLE "mi_qc_inspections" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "qc_no" VARCHAR(30) NOT NULL,
  "grn_id" BIGINT NOT NULL,
  "parent_qc_id" BIGINT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "assigned_to" BIGINT,
  "inspector_id" BIGINT,
  "inspection_date" DATE,
  "sample_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "overall_result" VARCHAR(30),
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "mi_qc_inspections_company_id_qc_no_key" ON "mi_qc_inspections"("company_id", "qc_no");
CREATE INDEX "mi_qc_inspections_grn_id_idx" ON "mi_qc_inspections"("grn_id");
CREATE INDEX "mi_qc_inspections_company_id_status_idx" ON "mi_qc_inspections"("company_id", "status");

CREATE TABLE "mi_qc_inspection_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "qc_id" BIGINT NOT NULL,
  "grn_line_id" BIGINT NOT NULL,
  "inspect_qty" DECIMAL(18,4) NOT NULL,
  "accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "rejected_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "conditional_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "rejection_reason_code" VARCHAR(30),
  "remarks" VARCHAR(1000)
);
CREATE INDEX "mi_qc_inspection_lines_qc_id_idx" ON "mi_qc_inspection_lines"("qc_id");
CREATE INDEX "mi_qc_inspection_lines_grn_line_id_idx" ON "mi_qc_inspection_lines"("grn_line_id");
ALTER TABLE "mi_qc_inspection_lines" ADD CONSTRAINT "mi_qc_inspection_lines_qc_id_fkey" FOREIGN KEY ("qc_id") REFERENCES "mi_qc_inspections"("id") ON DELETE CASCADE;

CREATE TABLE "mi_qc_check_results" (
  "id" BIGSERIAL PRIMARY KEY,
  "qc_line_id" BIGINT NOT NULL,
  "check_code" VARCHAR(30) NOT NULL,
  "actual_value" VARCHAR(200),
  "result" VARCHAR(10) NOT NULL
);
CREATE INDEX "mi_qc_check_results_qc_line_id_idx" ON "mi_qc_check_results"("qc_line_id");
ALTER TABLE "mi_qc_check_results" ADD CONSTRAINT "mi_qc_check_results_qc_line_id_fkey" FOREIGN KEY ("qc_line_id") REFERENCES "mi_qc_inspection_lines"("id") ON DELETE CASCADE;

CREATE TABLE "mi_supplier_cases" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "case_no" VARCHAR(30) NOT NULL,
  "grn_id" BIGINT NOT NULL,
  "qc_id" BIGINT NOT NULL,
  "po_id" BIGINT NOT NULL,
  "supplier_id" BIGINT NOT NULL,
  "buyer_id" BIGINT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "due_at" TIMESTAMP(3),
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "mi_supplier_cases_company_id_case_no_key" ON "mi_supplier_cases"("company_id", "case_no");
CREATE INDEX "mi_supplier_cases_company_id_status_idx" ON "mi_supplier_cases"("company_id", "status");

CREATE TABLE "mi_supplier_case_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "case_id" BIGINT NOT NULL,
  "grn_line_id" BIGINT NOT NULL,
  "qc_line_id" BIGINT,
  "rejection_reason_code" VARCHAR(30),
  "rejected_qty" DECIMAL(18,4) NOT NULL,
  "resolution_type" VARCHAR(30) NOT NULL,
  "resolution_qty" DECIMAL(18,4) NOT NULL,
  "resolved_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "remaining_qty" DECIMAL(18,4) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "remarks" VARCHAR(1000)
);
CREATE INDEX "mi_supplier_case_lines_case_id_idx" ON "mi_supplier_case_lines"("case_id");
ALTER TABLE "mi_supplier_case_lines" ADD CONSTRAINT "mi_supplier_case_lines_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "mi_supplier_cases"("id") ON DELETE CASCADE;

CREATE TABLE "mi_return_headers" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "return_no" VARCHAR(30) NOT NULL,
  "case_id" BIGINT NOT NULL,
  "case_line_id" BIGINT NOT NULL,
  "grn_id" BIGINT NOT NULL,
  "supplier_id" BIGINT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  "return_date" DATE,
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "mi_return_headers_company_id_return_no_key" ON "mi_return_headers"("company_id", "return_no");
ALTER TABLE "mi_return_headers" ADD CONSTRAINT "mi_return_headers_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "mi_supplier_cases"("id");

CREATE TABLE "mi_return_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "return_id" BIGINT NOT NULL,
  "item_id" BIGINT NOT NULL,
  "grn_line_id" BIGINT NOT NULL,
  "location_id" BIGINT NOT NULL,
  "qty" DECIMAL(18,4) NOT NULL,
  "uom_code" VARCHAR(10) NOT NULL
);
CREATE INDEX "mi_return_lines_return_id_idx" ON "mi_return_lines"("return_id");
ALTER TABLE "mi_return_lines" ADD CONSTRAINT "mi_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "mi_return_headers"("id") ON DELETE CASCADE;

CREATE TABLE "mi_putaway_tasks" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "task_no" VARCHAR(30) NOT NULL,
  "grn_id" BIGINT NOT NULL,
  "qc_id" BIGINT,
  "warehouse_id" BIGINT NOT NULL,
  "source" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "mi_putaway_tasks_company_id_task_no_key" ON "mi_putaway_tasks"("company_id", "task_no");
CREATE INDEX "mi_putaway_tasks_company_id_status_idx" ON "mi_putaway_tasks"("company_id", "status");

CREATE TABLE "mi_putaway_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "task_id" BIGINT NOT NULL,
  "grn_line_id" BIGINT NOT NULL,
  "item_id" BIGINT NOT NULL,
  "qty" DECIMAL(18,4) NOT NULL,
  "from_location_id" BIGINT NOT NULL,
  "suggested_location_id" BIGINT,
  "confirmed_location_id" BIGINT,
  "putaway_by" BIGINT,
  "putaway_at" TIMESTAMP(3)
);
CREATE INDEX "mi_putaway_lines_task_id_idx" ON "mi_putaway_lines"("task_id");
ALTER TABLE "mi_putaway_lines" ADD CONSTRAINT "mi_putaway_lines_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "mi_putaway_tasks"("id") ON DELETE CASCADE;

CREATE TABLE "mi_inv_ledger" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "txn_no" VARCHAR(30) NOT NULL,
  "txn_type" VARCHAR(30) NOT NULL,
  "doc_type" VARCHAR(20) NOT NULL,
  "doc_id" BIGINT NOT NULL,
  "doc_line_id" BIGINT,
  "item_id" BIGINT NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "location_id" BIGINT NOT NULL,
  "batch_no" VARCHAR(40) NOT NULL DEFAULT '',
  "serial_no" VARCHAR(60) NOT NULL DEFAULT '',
  "stock_status" VARCHAR(20) NOT NULL,
  "qty_in" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "qty_out" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "uom_code" VARCHAR(10) NOT NULL,
  "txn_date" DATE NOT NULL,
  "ref_doc_type" VARCHAR(20),
  "ref_doc_id" BIGINT,
  "reversal_of_id" BIGINT,
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mi_inv_ledger_item_wh_date_idx" ON "mi_inv_ledger"("item_id", "warehouse_id", "txn_date");
CREATE INDEX "mi_inv_ledger_doc_idx" ON "mi_inv_ledger"("company_id", "doc_type", "doc_id");

CREATE TABLE "mi_inv_balances" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "item_id" BIGINT NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "location_id" BIGINT NOT NULL,
  "batch_no" VARCHAR(40) NOT NULL DEFAULT '',
  "serial_no" VARCHAR(60) NOT NULL DEFAULT '',
  "stock_status" VARCHAR(20) NOT NULL,
  "on_hand_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "uom_code" VARCHAR(10) NOT NULL,
  "updated_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "mi_inv_balances_natural_key" ON "mi_inv_balances"("company_id", "item_id", "warehouse_id", "location_id", "batch_no", "serial_no", "stock_status");
CREATE INDEX "mi_inv_balances_item_status_idx" ON "mi_inv_balances"("company_id", "item_id", "stock_status");

CREATE TABLE "mi_ap_invoices" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "invoice_no" VARCHAR(40) NOT NULL,
  "invoice_date" DATE NOT NULL,
  "supplier_id" BIGINT NOT NULL,
  "po_id" BIGINT,
  "currency_code" VARCHAR(3) NOT NULL DEFAULT 'SGD',
  "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'MATCHED',
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "mi_ap_invoices_company_supplier_no_key" ON "mi_ap_invoices"("company_id", "supplier_id", "invoice_no");

CREATE TABLE "mi_ap_invoice_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "invoice_id" BIGINT NOT NULL,
  "item_id" BIGINT NOT NULL,
  "po_line_id" BIGINT,
  "grn_line_id" BIGINT,
  "qty" DECIMAL(18,4) NOT NULL,
  "unit_price" DECIMAL(18,4) NOT NULL,
  "tax_pct" DECIMAL(8,3) NOT NULL DEFAULT 0
);
CREATE INDEX "mi_ap_invoice_lines_invoice_id_idx" ON "mi_ap_invoice_lines"("invoice_id");
ALTER TABLE "mi_ap_invoice_lines" ADD CONSTRAINT "mi_ap_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "mi_ap_invoices"("id") ON DELETE CASCADE;

CREATE TABLE "mi_ap_matches" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "invoice_line_id" BIGINT NOT NULL,
  "po_line_id" BIGINT,
  "grn_line_id" BIGINT,
  "matched_qty" DECIMAL(18,4) NOT NULL,
  "po_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "invoice_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "price_variance" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "qty_variance" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "match_status" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mi_ap_matches_grn_line_id_idx" ON "mi_ap_matches"("grn_line_id");
ALTER TABLE "mi_ap_matches" ADD CONSTRAINT "mi_ap_matches_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "mi_ap_invoice_lines"("id") ON DELETE CASCADE;

CREATE TABLE "mi_tasks" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "task_type" VARCHAR(30) NOT NULL,
  "role_code" VARCHAR(30) NOT NULL,
  "doc_type" VARCHAR(20) NOT NULL,
  "doc_id" BIGINT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "due_at" TIMESTAMP(3),
  "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mi_tasks_company_role_status_idx" ON "mi_tasks"("company_id", "role_code", "status");

CREATE TABLE "mi_activities" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "doc_type" VARCHAR(20) NOT NULL,
  "doc_id" BIGINT NOT NULL,
  "event_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_id" BIGINT,
  "event_text" VARCHAR(500) NOT NULL
);
CREATE INDEX "mi_activities_doc_idx" ON "mi_activities"("company_id", "doc_type", "doc_id");

CREATE TABLE "mi_status_logs" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "doc_type" VARCHAR(20) NOT NULL,
  "doc_id" BIGINT NOT NULL,
  "from_status" VARCHAR(30),
  "to_status" VARCHAR(30) NOT NULL,
  "actor_id" BIGINT,
  "event_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remarks" VARCHAR(500)
);
CREATE INDEX "mi_status_logs_doc_idx" ON "mi_status_logs"("company_id", "doc_type", "doc_id");

CREATE TABLE "mi_rejection_reasons" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "reason_code" VARCHAR(30) NOT NULL,
  "reason_name" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX "mi_rejection_reasons_company_code_key" ON "mi_rejection_reasons"("company_id", "reason_code");

CREATE TABLE "mi_resolution_types" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "resolution_code" VARCHAR(30) NOT NULL,
  "resolution_name" VARCHAR(120) NOT NULL,
  "affects_stock" BOOLEAN NOT NULL DEFAULT FALSE,
  "requires_qc" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX "mi_resolution_types_company_code_key" ON "mi_resolution_types"("company_id", "resolution_code");
