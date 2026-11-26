-- UoM master: category + is_system; seed standard units per company.

ALTER TABLE "uoms"
  ADD COLUMN IF NOT EXISTS "category" VARCHAR(20) NOT NULL DEFAULT 'COUNT';

ALTER TABLE "uoms"
  ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;

-- Backfill known codes
UPDATE "uoms" SET "category" = 'COUNT', "is_system" = true, "decimal_places" = 0
WHERE upper("code") IN ('NOS', 'SET', 'PAIR') AND "deleted_at" IS NULL;

UPDATE "uoms" SET "category" = 'PACKAGING', "is_system" = true, "decimal_places" = 0
WHERE upper("code") IN ('BOX', 'PACK', 'ROLL', 'DRUM', 'BAG') AND "deleted_at" IS NULL;

UPDATE "uoms" SET "category" = 'LENGTH', "is_system" = true, "decimal_places" = 3
WHERE upper("code") IN ('MTR', 'CM', 'MM', 'FT') AND "deleted_at" IS NULL;

UPDATE "uoms" SET "category" = 'WEIGHT', "is_system" = true, "decimal_places" = 3
WHERE upper("code") IN ('KG', 'GM', 'TON') AND "deleted_at" IS NULL;

UPDATE "uoms" SET "category" = 'VOLUME', "is_system" = true, "decimal_places" = 3
WHERE upper("code") IN ('LTR', 'ML') AND "deleted_at" IS NULL;

-- Seed missing standard UOMs for every company
INSERT INTO "uoms" ("company_id", "code", "name", "category", "decimal_places", "is_active", "is_system", "created_at")
SELECT c."company_id", v.code, v.name, v.category, v.decimal_places, true, true, NOW()
FROM "companies" c
CROSS JOIN (
  VALUES
    ('NOS', 'Numbers', 'COUNT', 0),
    ('SET', 'Set', 'COUNT', 0),
    ('PAIR', 'Pair', 'COUNT', 0),
    ('BOX', 'Box', 'PACKAGING', 0),
    ('PACK', 'Pack', 'PACKAGING', 0),
    ('ROLL', 'Roll', 'PACKAGING', 0),
    ('DRUM', 'Drum', 'PACKAGING', 0),
    ('BAG', 'Bag', 'PACKAGING', 0),
    ('MTR', 'Meter', 'LENGTH', 3),
    ('CM', 'Centimeter', 'LENGTH', 3),
    ('MM', 'Millimeter', 'LENGTH', 3),
    ('FT', 'Foot', 'LENGTH', 3),
    ('KG', 'Kilogram', 'WEIGHT', 3),
    ('GM', 'Gram', 'WEIGHT', 3),
    ('TON', 'Ton', 'WEIGHT', 3),
    ('LTR', 'Litre', 'VOLUME', 3),
    ('ML', 'Millilitre', 'VOLUME', 3)
) AS v(code, name, category, decimal_places)
WHERE c."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "uoms" u
    WHERE u."company_id" = c."company_id"
      AND upper(u."code") = v.code
      AND u."deleted_at" IS NULL
  );

-- Normalize standard codes to uppercase (unique index is case-sensitive)
UPDATE "uoms" SET "code" = upper("code")
WHERE upper("code") IN (
  'NOS','SET','PAIR','BOX','PACK','ROLL','DRUM','BAG','MTR','CM','MM','FT','KG','GM','TON','LTR','ML'
)
AND "code" <> upper("code")
AND "deleted_at" IS NULL;
