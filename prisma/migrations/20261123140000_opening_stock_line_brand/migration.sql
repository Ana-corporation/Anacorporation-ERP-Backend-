-- Opening Stock Phase 1: optional brand on document / import lines (reference only).
-- Stock key unchanged: Part + Store + Bin.

ALTER TABLE "inventory_document_lines"
  ADD COLUMN IF NOT EXISTS "brand" VARCHAR(60);

ALTER TABLE "opening_stock_import_rows"
  ADD COLUMN IF NOT EXISTS "brand" VARCHAR(60);
