-- UoM decimal precision for Opening Stock / qty validation (additive).
-- Existing rows get sensible defaults by code; new UOMs default to 6 (BE max).

ALTER TABLE "uoms"
  ADD COLUMN IF NOT EXISTS "decimal_places" SMALLINT NOT NULL DEFAULT 6;

UPDATE "uoms"
SET "decimal_places" = 0
WHERE upper("code") IN ('NOS', 'PCS', 'PC', 'EA', 'SET', 'PAIR', 'UNIT', 'UNITS');

UPDATE "uoms"
SET "decimal_places" = 3
WHERE upper("code") IN (
  'KG', 'G', 'MTR', 'M', 'METER', 'METRE', 'MM', 'CM',
  'LTR', 'L', 'LITRE', 'LITER', 'ML', 'SQ.M', 'SQM', 'M2'
);

ALTER TABLE "uoms"
  DROP CONSTRAINT IF EXISTS "uoms_decimal_places_range";

ALTER TABLE "uoms"
  ADD CONSTRAINT "uoms_decimal_places_range"
  CHECK ("decimal_places" >= 0 AND "decimal_places" <= 6);
