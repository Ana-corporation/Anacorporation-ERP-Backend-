-- Stable product identity for per-company SYSTEM roles.
-- Same system_template_key across companies = same product template, different rows.

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "system_template_key" VARCHAR(40);

CREATE INDEX IF NOT EXISTS "roles_system_template_key_idx"
  ON "roles" ("system_template_key");

-- At most one non-deleted SYSTEM instance of each template per company.
CREATE UNIQUE INDEX IF NOT EXISTS "roles_company_system_template_key_uidx"
  ON "roles" ("company_id", "system_template_key")
  WHERE "system_template_key" IS NOT NULL
    AND "deleted_at" IS NULL;

-- Backfill from role_code for existing SYSTEM rows (safe heuristic).
UPDATE "roles"
SET "system_template_key" = "role_code"
WHERE "is_system" = true
  AND "system_template_key" IS NULL
  AND "deleted_at" IS NULL
  AND "role_code" IN (
    'ADMIN',
    'MANAGER',
    'STAFF',
    'SALES',
    'VENDOR',
    'INVENTORY_ADMIN',
    'PLATFORM_OWNER'
  );
