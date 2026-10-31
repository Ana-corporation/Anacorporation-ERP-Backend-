-- Over-receipt tolerance, period close, GRN reversal link, attachments,
-- QC templates, put-away rules, escalation, role actions, match policy, UOM conversion.

ALTER TABLE "mi_purchase_order_lines"
  ADD COLUMN "stock_uom_code" VARCHAR(10) NOT NULL DEFAULT 'PCS',
  ADD COLUMN "conversion_factor" DECIMAL(18,6) NOT NULL DEFAULT 1;

ALTER TABLE "mi_grn_headers"
  ADD COLUMN "period_id" BIGINT;

ALTER TABLE "mi_grn_lines"
  ADD COLUMN "purchase_uom_code" VARCHAR(10) NOT NULL DEFAULT 'PCS',
  ADD COLUMN "inventory_uom_code" VARCHAR(10) NOT NULL DEFAULT 'PCS',
  ADD COLUMN "conversion_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN "tolerance_pct_applied" DECIMAL(8,3) NOT NULL DEFAULT 0;

ALTER TABLE "mi_rejection_reasons"
  ADD COLUMN "requires_photo" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "mi_tasks"
  ADD COLUMN "assignee_id" BIGINT,
  ADD COLUMN "escalated" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "escalated_at" TIMESTAMP(3);

ALTER TABLE "mi_activities"
  ADD COLUMN "related_doc_type" VARCHAR(20),
  ADD COLUMN "related_doc_id" BIGINT;

ALTER TABLE "mi_ap_matches"
  ADD COLUMN "tax_variance" DECIMAL(18,4) NOT NULL DEFAULT 0;

CREATE TABLE "mi_cfg_tolerances" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "scope_type" VARCHAR(20) NOT NULL,
  "scope_id" BIGINT NOT NULL DEFAULT 0,
  "over_receipt_pct" DECIMAL(8,3) NOT NULL DEFAULT 0,
  "price_variance_pct" DECIMAL(8,3) NOT NULL DEFAULT 0,
  "tax_variance_pct" DECIMAL(8,3) NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "mi_cfg_tolerances_scope_key" ON "mi_cfg_tolerances"("company_id", "scope_type", "scope_id");
ALTER TABLE "mi_cfg_tolerances" ADD CONSTRAINT "mi_cfg_tolerances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;

CREATE TABLE "mi_cfg_notify_rules" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "event_code" VARCHAR(40) NOT NULL,
  "threshold_hours" INTEGER NOT NULL,
  "escalate_to_role" VARCHAR(30) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX "mi_cfg_notify_rules_event_key" ON "mi_cfg_notify_rules"("company_id", "event_code");
ALTER TABLE "mi_cfg_notify_rules" ADD CONSTRAINT "mi_cfg_notify_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;

CREATE TABLE "mi_cfg_periods" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "period_year" INTEGER NOT NULL,
  "period_month" INTEGER NOT NULL,
  "inventory_status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
  "closed_by" BIGINT,
  "closed_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "mi_cfg_periods_month_key" ON "mi_cfg_periods"("company_id", "period_year", "period_month");
ALTER TABLE "mi_cfg_periods" ADD CONSTRAINT "mi_cfg_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
ALTER TABLE "mi_grn_headers" ADD CONSTRAINT "mi_grn_headers_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "mi_cfg_periods"("id");

CREATE TABLE "mi_cfg_number_series" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "doc_type" VARCHAR(20) NOT NULL,
  "prefix" VARCHAR(10) NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  "padding" INTEGER NOT NULL DEFAULT 6
);
CREATE UNIQUE INDEX "mi_cfg_number_series_doc_key" ON "mi_cfg_number_series"("company_id", "doc_type");
ALTER TABLE "mi_cfg_number_series" ADD CONSTRAINT "mi_cfg_number_series_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;

CREATE TABLE "mi_cfg_match_policies" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "match_qty_basis" VARCHAR(20) NOT NULL DEFAULT 'ACCEPTED'
);
CREATE UNIQUE INDEX "mi_cfg_match_policies_company_key" ON "mi_cfg_match_policies"("company_id");
ALTER TABLE "mi_cfg_match_policies" ADD CONSTRAINT "mi_cfg_match_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;

CREATE TABLE "mi_sec_roles" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "role_code" VARCHAR(30) NOT NULL,
  "role_name" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX "mi_sec_roles_code_key" ON "mi_sec_roles"("company_id", "role_code");
ALTER TABLE "mi_sec_roles" ADD CONSTRAINT "mi_sec_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;

CREATE TABLE "mi_sec_role_actions" (
  "id" BIGSERIAL PRIMARY KEY,
  "role_id" BIGINT NOT NULL,
  "module_code" VARCHAR(30) NOT NULL,
  "action_code" VARCHAR(30) NOT NULL
);
CREATE UNIQUE INDEX "mi_sec_role_actions_key" ON "mi_sec_role_actions"("role_id", "module_code", "action_code");
ALTER TABLE "mi_sec_role_actions" ADD CONSTRAINT "mi_sec_role_actions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "mi_sec_roles"("id") ON DELETE CASCADE;

CREATE TABLE "mi_qc_templates" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "template_code" VARCHAR(30) NOT NULL,
  "template_name" VARCHAR(120) NOT NULL,
  "sample_rule" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "sample_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX "mi_qc_templates_code_key" ON "mi_qc_templates"("company_id", "template_code");
ALTER TABLE "mi_qc_templates" ADD CONSTRAINT "mi_qc_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;

CREATE TABLE "mi_qc_template_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "template_id" BIGINT NOT NULL,
  "check_code" VARCHAR(30) NOT NULL,
  "spec_text" VARCHAR(200),
  "min_value" DECIMAL(18,4),
  "max_value" DECIMAL(18,4),
  "result_type" VARCHAR(20) NOT NULL DEFAULT 'PASS_FAIL',
  "mandatory" BOOLEAN NOT NULL DEFAULT FALSE,
  "sequence_no" INTEGER NOT NULL DEFAULT 10
);
CREATE UNIQUE INDEX "mi_qc_template_lines_code_key" ON "mi_qc_template_lines"("template_id", "check_code");
ALTER TABLE "mi_qc_template_lines" ADD CONSTRAINT "mi_qc_template_lines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "mi_qc_templates"("id") ON DELETE CASCADE;

CREATE TABLE "mi_item_qc" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "item_id" BIGINT NOT NULL,
  "template_id" BIGINT NOT NULL
);
CREATE UNIQUE INDEX "mi_item_qc_item_key" ON "mi_item_qc"("company_id", "item_id");
ALTER TABLE "mi_item_qc" ADD CONSTRAINT "mi_item_qc_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
ALTER TABLE "mi_item_qc" ADD CONSTRAINT "mi_item_qc_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id");
ALTER TABLE "mi_item_qc" ADD CONSTRAINT "mi_item_qc_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "mi_qc_templates"("id") ON DELETE CASCADE;

CREATE TABLE "mi_item_putaway_rules" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "item_id" BIGINT NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "preferred_location_id" BIGINT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 1,
  "max_qty" DECIMAL(18,4),
  "active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX "mi_item_putaway_rules_item_idx" ON "mi_item_putaway_rules"("company_id", "item_id", "warehouse_id");
ALTER TABLE "mi_item_putaway_rules" ADD CONSTRAINT "mi_item_putaway_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
ALTER TABLE "mi_item_putaway_rules" ADD CONSTRAINT "mi_item_putaway_rules_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id");
ALTER TABLE "mi_item_putaway_rules" ADD CONSTRAINT "mi_item_putaway_rules_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id");
ALTER TABLE "mi_item_putaway_rules" ADD CONSTRAINT "mi_item_putaway_rules_location_id_fkey" FOREIGN KEY ("preferred_location_id") REFERENCES "mi_storage_locations"("id");

CREATE TABLE "mi_uom_conversions" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "item_id" BIGINT,
  "from_uom_code" VARCHAR(10) NOT NULL,
  "to_uom_code" VARCHAR(10) NOT NULL,
  "factor" DECIMAL(18,6) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX "mi_uom_conversions_pair_idx" ON "mi_uom_conversions"("company_id", "from_uom_code", "to_uom_code");
ALTER TABLE "mi_uom_conversions" ADD CONSTRAINT "mi_uom_conversions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
ALTER TABLE "mi_uom_conversions" ADD CONSTRAINT "mi_uom_conversions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id");

CREATE TABLE "mi_attachments" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "doc_type" VARCHAR(20) NOT NULL,
  "doc_id" BIGINT NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "file_url" VARCHAR(500) NOT NULL,
  "mime_type" VARCHAR(120),
  "category" VARCHAR(20) NOT NULL DEFAULT 'DO',
  "uploaded_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mi_attachments_doc_idx" ON "mi_attachments"("company_id", "doc_type", "doc_id");
ALTER TABLE "mi_attachments" ADD CONSTRAINT "mi_attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;

CREATE TABLE "mi_notifications" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "user_id" BIGINT,
  "role_code" VARCHAR(30),
  "task_id" BIGINT,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mi_notifications_role_idx" ON "mi_notifications"("company_id", "role_code", "read_at");
ALTER TABLE "mi_notifications" ADD CONSTRAINT "mi_notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
