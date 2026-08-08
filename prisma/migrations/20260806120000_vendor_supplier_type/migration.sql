-- Persist Ana supplier type on vendors (for FE list/detail + filter).
-- Values: RM Supplier | Component Supplier | Service Provider | Electrical Suppliers

ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "supplier_type" VARCHAR(40);

-- Backfill from typed codes (RM001 / CS001 / SP001 / ES001)
UPDATE "vendors"
SET "supplier_type" = CASE
  WHEN "vendor_code" ~ '^[Rr][Mm][0-9]{3}$' THEN 'RM Supplier'
  WHEN "vendor_code" ~ '^[Cc][Ss][0-9]{3}$' THEN 'Component Supplier'
  WHEN "vendor_code" ~ '^[Ss][Pp][0-9]{3}$' THEN 'Service Provider'
  WHEN "vendor_code" ~ '^[Ee][Ss][0-9]{3}$' THEN 'Electrical Suppliers'
  ELSE "supplier_type"
END
WHERE "supplier_type" IS NULL;

CREATE INDEX IF NOT EXISTS "vendors_company_id_supplier_type_idx"
  ON "vendors" ("company_id", "supplier_type");
