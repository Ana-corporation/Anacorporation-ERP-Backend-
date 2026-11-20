-- Bin integrity phase 1: system bins, bin status, stock transfer movements

-- Storage bins: system flag + status (ACTIVE | BLOCKED | INACTIVE)
ALTER TABLE "storage_bins" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "storage_bins" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';

UPDATE "storage_bins" SET "status" = CASE WHEN "is_active" THEN 'ACTIVE' ELSE 'INACTIVE' END
WHERE "status" IS NULL OR "status" = 'ACTIVE';

ALTER TABLE "storage_bins" DROP CONSTRAINT IF EXISTS "storage_bins_status_check";
ALTER TABLE "storage_bins" ADD CONSTRAINT "storage_bins_status_check"
  CHECK ("status" IN ('ACTIVE', 'BLOCKED', 'INACTIVE'));

-- Inventory document type: stock transfer
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'inventory_document_type' AND e.enumlabel = 'STOCK_TRANSFER'
  ) THEN
    ALTER TYPE "inventory_document_type" ADD VALUE 'STOCK_TRANSFER';
  END IF;
END $$;

-- Ledger movement types for transfers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'stock_movement_type' AND e.enumlabel = 'TRANSFER_OUT'
  ) THEN
    ALTER TYPE "stock_movement_type" ADD VALUE 'TRANSFER_OUT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'stock_movement_type' AND e.enumlabel = 'TRANSFER_IN'
  ) THEN
    ALTER TYPE "stock_movement_type" ADD VALUE 'TRANSFER_IN';
  END IF;
END $$;

-- Transfer lines need destination bin (nullable for other document types)
ALTER TABLE "inventory_document_lines" ADD COLUMN IF NOT EXISTS "to_storage_bin_id" BIGINT;
ALTER TABLE "inventory_document_lines" DROP CONSTRAINT IF EXISTS "inventory_document_lines_to_storage_bin_id_fkey";
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_to_storage_bin_id_fkey"
  FOREIGN KEY ("to_storage_bin_id") REFERENCES "storage_bins"("storage_bin_id") ON DELETE NO ACTION ON UPDATE CASCADE;
