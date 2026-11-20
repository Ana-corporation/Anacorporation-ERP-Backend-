-- ERP employee master (salesperson / store-keeper / approver / shop-floor worker).
-- Adds work-location (warehouse), preferred/middle name, Number Series EMPLOYEE,
-- extra employment status/type values. No HRMS tables (bank, IDs, payroll).
-- Existing employees rows are unchanged. LIVE apply only with explicit approval.

ALTER TYPE "number_series_document_type" ADD VALUE 'EMPLOYEE';

ALTER TYPE "employment_status" ADD VALUE 'candidate';
ALTER TYPE "employment_status" ADD VALUE 'suspended';
ALTER TYPE "employment_status" ADD VALUE 'notice_period';
ALTER TYPE "employment_status" ADD VALUE 'exited';

ALTER TYPE "employment_type" ADD VALUE 'apprentice';
ALTER TYPE "employment_type" ADD VALUE 'daily_wage';

ALTER TABLE "employees" ADD COLUMN "middle_name" VARCHAR(100);
ALTER TABLE "employees" ADD COLUMN "preferred_name" VARCHAR(100);
ALTER TABLE "employees" ADD COLUMN "warehouse_id" BIGINT;

CREATE INDEX "employees_warehouse_id_idx" ON "employees"("warehouse_id");

ALTER TABLE "employees" ADD CONSTRAINT "employees_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE SET NULL ON UPDATE CASCADE;
