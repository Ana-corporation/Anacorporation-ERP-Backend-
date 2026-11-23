-- Purchase order module.
-- Ten tables. Masters (vendors, items, warehouses, machines, boms, uoms,
-- payment_terms, currencies, users, roles, file_assets) are reused.
-- Foreign keys to machines, boms, uoms and payment_terms are added only
-- when that table is already in this schema, so this migration can replay
-- before those models are committed.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'purchase_requirement_source_type'
  ) THEN
    CREATE TYPE "purchase_requirement_source_type" AS ENUM ('SHORTAGE', 'REPLENISHMENT');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'purchase_requirement_status'
  ) THEN
    CREATE TYPE "purchase_requirement_status" AS ENUM (
      'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PARTIALLY_CONVERTED', 'FULLY_CONVERTED', 'CANCELLED'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'purchase_order_type'
  ) THEN
    CREATE TYPE "purchase_order_type" AS ENUM ('PRODUCTION', 'REPLENISHMENT');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'purchase_order_status'
  ) THEN
    CREATE TYPE "purchase_order_status" AS ENUM (
      'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED',
      'FULLY_RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'purchase_order_send_status'
  ) THEN
    CREATE TYPE "purchase_order_send_status" AS ENUM ('NOT_SENT', 'QUEUED', 'SENT', 'FAILED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'purchase_approval_action'
  ) THEN
    CREATE TYPE "purchase_approval_action" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'WITHDRAW');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'purchase_email_status'
  ) THEN
    CREATE TYPE "purchase_email_status" AS ENUM ('QUEUED', 'SENT', 'FAILED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "purchase_settings" (
  "company_id" BIGINT NOT NULL,
  "self_approval_allowed" BOOLEAN NOT NULL DEFAULT FALSE,
  "over_receipt_tolerance_pct" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "email_max_attempts" INTEGER NOT NULL DEFAULT 3,
  "email_retry_interval_seconds" INTEGER NOT NULL DEFAULT 300,
  "email_subject_template" VARCHAR(200),
  "email_body_template" TEXT,
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" BIGINT,
  "updated_at" TIMESTAMP(3),
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "purchase_settings_pkey" PRIMARY KEY ("company_id")
);

CREATE TABLE IF NOT EXISTS "purchase_approval_rules" (
  "purchase_approval_rule_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "po_type" "purchase_order_type" NOT NULL,
  "amount_from" DECIMAL(18,6) NOT NULL,
  "amount_to" DECIMAL(18,6),
  "currency_id" BIGINT NOT NULL,
  "approver_role_id" BIGINT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" BIGINT,
  "updated_at" TIMESTAMP(3),
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "purchase_approval_rules_pkey" PRIMARY KEY ("purchase_approval_rule_id")
);

CREATE TABLE IF NOT EXISTS "purchase_requirement_runs" (
  "purchase_requirement_run_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "machine_id" BIGINT NOT NULL,
  "bom_id" BIGINT NOT NULL,
  "bom_version" INTEGER NOT NULL,
  "bom_number" VARCHAR(40) NOT NULL,
  "machine_qty" DECIMAL(18,6) NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "required_date" DATE NOT NULL,
  "lines_snapshot" JSONB NOT NULL,
  "idempotency_key" VARCHAR(80),
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_requirement_runs_pkey" PRIMARY KEY ("purchase_requirement_run_id")
);

CREATE TABLE IF NOT EXISTS "purchase_requirements" (
  "purchase_requirement_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "pr_no" VARCHAR(30) NOT NULL,
  "source_type" "purchase_requirement_source_type" NOT NULL,
  "run_id" BIGINT,
  "machine_id" BIGINT,
  "bom_id" BIGINT,
  "bom_version" INTEGER,
  "bom_number" VARCHAR(40),
  "item_id" BIGINT NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "uom_id" BIGINT,
  "required_qty" DECIMAL(18,6) NOT NULL,
  "converted_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "required_date" DATE NOT NULL,
  "suggested_vendor_id" BIGINT,
  "reason" TEXT,
  "status" "purchase_requirement_status" NOT NULL DEFAULT 'DRAFT',
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" BIGINT,
  "updated_at" TIMESTAMP(3),
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "purchase_requirements_pkey" PRIMARY KEY ("purchase_requirement_id")
);

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "purchase_order_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "po_no" VARCHAR(30) NOT NULL,
  "po_type" "purchase_order_type" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "vendor_id" BIGINT NOT NULL,
  "vendor_snapshot" JSONB,
  "po_date" DATE NOT NULL,
  "currency_id" BIGINT NOT NULL,
  "payment_term_id" BIGINT,
  "payment_term_snapshot" JSONB,
  "delivery_date" DATE NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "buyer_id" BIGINT NOT NULL,
  "vendor_reference" VARCHAR(80),
  "internal_notes" TEXT,
  "supplier_notes" TEXT,
  "reason" TEXT,
  "subtotal" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "discount_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "freight_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "other_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "grand_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
  "send_status" "purchase_order_send_status" NOT NULL DEFAULT 'NOT_SENT',
  "submitted_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "approved_by" BIGINT,
  "closed_at" TIMESTAMP(3),
  "close_reason" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "cancel_reason" TEXT,
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" BIGINT,
  "updated_at" TIMESTAMP(3),
  "row_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("purchase_order_id")
);

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "purchase_order_line_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "purchase_order_id" BIGINT NOT NULL,
  "line_no" INTEGER NOT NULL,
  "item_id" BIGINT NOT NULL,
  "description" VARCHAR(500),
  "uom_id" BIGINT,
  "uom_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "inventory_uom_id" BIGINT,
  "ordered_qty" DECIMAL(18,6) NOT NULL,
  "original_qty" DECIMAL(18,6),
  "unit_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "discount_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "tax_pct" DECIMAL(8,3) NOT NULL DEFAULT 0,
  "net_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "gross_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "required_date" DATE,
  "warehouse_id" BIGINT NOT NULL,
  "received_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "accepted_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "rejected_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "outstanding_qty" DECIMAL(18,6) NOT NULL,
  "variance_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),
  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("purchase_order_line_id")
);

CREATE TABLE IF NOT EXISTS "purchase_order_line_sources" (
  "purchase_order_line_source_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "purchase_order_line_id" BIGINT NOT NULL,
  "purchase_requirement_id" BIGINT NOT NULL,
  "qty" DECIMAL(18,6) NOT NULL,
  CONSTRAINT "purchase_order_line_sources_pkey" PRIMARY KEY ("purchase_order_line_source_id")
);

CREATE TABLE IF NOT EXISTS "purchase_order_versions" (
  "purchase_order_version_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "purchase_order_id" BIGINT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "pdf_file_id" UUID,
  "created_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_versions_pkey" PRIMARY KEY ("purchase_order_version_id")
);

CREATE TABLE IF NOT EXISTS "purchase_order_approvals" (
  "purchase_order_approval_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "purchase_order_id" BIGINT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" "purchase_approval_action" NOT NULL,
  "user_id" BIGINT NOT NULL,
  "comment" TEXT,
  "acted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_approvals_pkey" PRIMARY KEY ("purchase_order_approval_id")
);

CREATE TABLE IF NOT EXISTS "purchase_email_attempts" (
  "purchase_email_attempt_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "purchase_order_id" BIGINT NOT NULL,
  "version" INTEGER NOT NULL,
  "recipient" VARCHAR(255) NOT NULL,
  "status" "purchase_email_status" NOT NULL,
  "error_message" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_by" BIGINT,
  CONSTRAINT "purchase_email_attempts_pkey" PRIMARY KEY ("purchase_email_attempt_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requirement_runs_company_id_idempotency_key_key"
  ON "purchase_requirement_runs" ("company_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "purchase_requirement_runs_company_id_machine_id_idx"
  ON "purchase_requirement_runs" ("company_id", "machine_id");
CREATE INDEX IF NOT EXISTS "purchase_requirement_runs_company_id_bom_id_idx"
  ON "purchase_requirement_runs" ("company_id", "bom_id");

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requirements_company_id_pr_no_key"
  ON "purchase_requirements" ("company_id", "pr_no");
CREATE INDEX IF NOT EXISTS "purchase_requirements_company_id_status_idx"
  ON "purchase_requirements" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_requirements_company_id_item_id_idx"
  ON "purchase_requirements" ("company_id", "item_id");
CREATE INDEX IF NOT EXISTS "purchase_requirements_company_id_warehouse_id_idx"
  ON "purchase_requirements" ("company_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "purchase_requirements_company_id_suggested_vendor_id_idx"
  ON "purchase_requirements" ("company_id", "suggested_vendor_id");

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_company_id_po_no_key"
  ON "purchase_orders" ("company_id", "po_no");
CREATE INDEX IF NOT EXISTS "purchase_orders_company_id_status_idx"
  ON "purchase_orders" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_orders_company_id_send_status_idx"
  ON "purchase_orders" ("company_id", "send_status");
CREATE INDEX IF NOT EXISTS "purchase_orders_company_id_po_type_idx"
  ON "purchase_orders" ("company_id", "po_type");
CREATE INDEX IF NOT EXISTS "purchase_orders_company_id_vendor_id_idx"
  ON "purchase_orders" ("company_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_company_id_warehouse_id_idx"
  ON "purchase_orders" ("company_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_company_id_buyer_id_idx"
  ON "purchase_orders" ("company_id", "buyer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_lines_purchase_order_id_line_no_key"
  ON "purchase_order_lines" ("purchase_order_id", "line_no");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_purchase_order_id_item_id_idx"
  ON "purchase_order_lines" ("purchase_order_id", "item_id");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_company_id_item_id_idx"
  ON "purchase_order_lines" ("company_id", "item_id");

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_line_sources_line_requirement_key"
  ON "purchase_order_line_sources" ("purchase_order_line_id", "purchase_requirement_id");
CREATE INDEX IF NOT EXISTS "purchase_order_line_sources_purchase_requirement_id_idx"
  ON "purchase_order_line_sources" ("purchase_requirement_id");

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_versions_purchase_order_id_version_key"
  ON "purchase_order_versions" ("purchase_order_id", "version");

CREATE INDEX IF NOT EXISTS "purchase_order_approvals_purchase_order_id_version_idx"
  ON "purchase_order_approvals" ("purchase_order_id", "version");
CREATE INDEX IF NOT EXISTS "purchase_order_approvals_company_id_user_id_idx"
  ON "purchase_order_approvals" ("company_id", "user_id");

CREATE INDEX IF NOT EXISTS "purchase_email_attempts_company_id_status_idx"
  ON "purchase_email_attempts" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_email_attempts_purchase_order_id_version_idx"
  ON "purchase_email_attempts" ("purchase_order_id", "version");

CREATE INDEX IF NOT EXISTS "purchase_approval_rules_company_id_po_type_is_active_idx"
  ON "purchase_approval_rules" ("company_id", "po_type", "is_active");
CREATE INDEX IF NOT EXISTS "purchase_approval_rules_company_id_currency_id_idx"
  ON "purchase_approval_rules" ("company_id", "currency_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_settings_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_settings" ADD CONSTRAINT "purchase_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_approval_rules_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_approval_rules" ADD CONSTRAINT "purchase_approval_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_approval_rules_currency_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_approval_rules" ADD CONSTRAINT "purchase_approval_rules_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("currency_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_approval_rules_approver_role_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_approval_rules" ADD CONSTRAINT "purchase_approval_rules_approver_role_id_fkey" FOREIGN KEY ("approver_role_id") REFERENCES "roles"("role_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirement_runs_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirement_runs" ADD CONSTRAINT "purchase_requirement_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirement_runs_warehouse_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirement_runs" ADD CONSTRAINT "purchase_requirement_runs_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_run_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "purchase_requirement_runs"("purchase_requirement_run_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_item_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_warehouse_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_suggested_vendor_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_suggested_vendor_id_fkey" FOREIGN KEY ("suggested_vendor_id") REFERENCES "vendors"("vendor_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_vendor_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_currency_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("currency_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_warehouse_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_buyer_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("user_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_approved_by_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("user_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_lines_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_lines_purchase_order_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("purchase_order_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_lines_item_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_lines_warehouse_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_line_sources_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_line_sources" ADD CONSTRAINT "purchase_order_line_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_line_sources_purchase_order_line_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_line_sources" ADD CONSTRAINT "purchase_order_line_sources_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("purchase_order_line_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_line_sources_purchase_requirement_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_line_sources" ADD CONSTRAINT "purchase_order_line_sources_purchase_requirement_id_fkey" FOREIGN KEY ("purchase_requirement_id") REFERENCES "purchase_requirements"("purchase_requirement_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_versions_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_versions" ADD CONSTRAINT "purchase_order_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_versions_purchase_order_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_versions" ADD CONSTRAINT "purchase_order_versions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("purchase_order_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_versions_pdf_file_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_versions" ADD CONSTRAINT "purchase_order_versions_pdf_file_id_fkey" FOREIGN KEY ("pdf_file_id") REFERENCES "file_assets"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_approvals_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_approvals_purchase_order_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("purchase_order_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_approvals_user_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_email_attempts_company_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_email_attempts" ADD CONSTRAINT "purchase_email_attempts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_email_attempts_purchase_order_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_email_attempts" ADD CONSTRAINT "purchase_email_attempts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("purchase_order_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_email_attempts_sent_by_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_email_attempts" ADD CONSTRAINT "purchase_email_attempts_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("user_id");
  END IF;
END
$$;

-- Masters that live in the database but are not in this repo's committed migrations yet.
DO $$
BEGIN
  IF to_regclass(format('%I.machines', current_schema())) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirement_runs_machine_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirement_runs" ADD CONSTRAINT "purchase_requirement_runs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id");
  END IF;
  IF to_regclass(format('%I.boms', current_schema())) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirement_runs_bom_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirement_runs" ADD CONSTRAINT "purchase_requirement_runs_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("bom_id");
  END IF;
  IF to_regclass(format('%I.machines', current_schema())) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_machine_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id");
  END IF;
  IF to_regclass(format('%I.boms', current_schema())) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_bom_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("bom_id");
  END IF;
  IF to_regclass(format('%I.uoms', current_schema())) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_uom_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "uoms"("uom_id");
  END IF;
  IF to_regclass(format('%I.uoms', current_schema())) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_lines_uom_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "uoms"("uom_id");
  END IF;
  IF to_regclass(format('%I.uoms', current_schema())) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_lines_inventory_uom_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_inventory_uom_id_fkey" FOREIGN KEY ("inventory_uom_id") REFERENCES "uoms"("uom_id");
  END IF;
  IF to_regclass(format('%I.payment_terms', current_schema())) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_payment_term_id_fkey' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("payment_term_id");
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_settings_tolerance_check' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_settings" ADD CONSTRAINT "purchase_settings_tolerance_check" CHECK ("over_receipt_tolerance_pct" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_settings_email_check' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_settings" ADD CONSTRAINT "purchase_settings_email_check" CHECK ("email_max_attempts" >= 1 AND "email_retry_interval_seconds" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_approval_rules_amount_check' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_approval_rules" ADD CONSTRAINT "purchase_approval_rules_amount_check" CHECK ("amount_from" >= 0 AND ("amount_to" IS NULL OR "amount_to" >= "amount_from"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirement_runs_qty_check' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirement_runs" ADD CONSTRAINT "purchase_requirement_runs_qty_check" CHECK ("machine_qty" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requirements_qty_check' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_requirements" ADD CONSTRAINT "purchase_requirements_qty_check" CHECK ("required_qty" > 0 AND "converted_qty" >= 0 AND "converted_qty" <= "required_qty");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_lines_qty_check' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_qty_check" CHECK (
      "ordered_qty" > 0
      AND "uom_factor" > 0
      AND "received_qty" >= 0
      AND "accepted_qty" >= 0
      AND "rejected_qty" >= 0
      AND "outstanding_qty" >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_line_sources_qty_check' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_order_line_sources" ADD CONSTRAINT "purchase_order_line_sources_qty_check" CHECK ("qty" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_email_attempts_retry_check' AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "purchase_email_attempts" ADD CONSTRAINT "purchase_email_attempts_retry_check" CHECK ("retry_count" >= 0);
  END IF;
END
$$;
