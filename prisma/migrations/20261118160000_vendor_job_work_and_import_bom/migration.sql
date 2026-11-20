-- Vendor: Is Job Work Vendor (Sub Contractor Store stock only accepts these)
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "is_job_work_vendor" BOOLEAN NOT NULL DEFAULT false;

-- Opening stock: per-row zero-valuation confirm
ALTER TABLE "opening_stock_import_rows" ADD COLUMN IF NOT EXISTS "zero_price_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- Import sessions: BOM Excel import
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'import_type' AND e.enumlabel = 'BOM'
  ) THEN
    ALTER TYPE "import_type" ADD VALUE 'BOM';
  END IF;
END $$;
