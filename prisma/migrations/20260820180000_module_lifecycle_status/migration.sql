-- Module lifecycle status for customer entitlement gating.
-- AVAILABLE = grantable to tenants; DEVELOPMENT/etc = catalogue only.

CREATE TYPE "module_lifecycle_status" AS ENUM (
  'DEVELOPMENT',
  'TESTING',
  'INTERNAL',
  'AVAILABLE',
  'DEPRECATED',
  'DISABLED'
);

ALTER TABLE "modules"
  ADD COLUMN IF NOT EXISTS "lifecycle_status" "module_lifecycle_status" NOT NULL DEFAULT 'DEVELOPMENT';

-- Current product surface: Vendors + Items live under supply-chain.
UPDATE "modules"
SET "lifecycle_status" = 'AVAILABLE'
WHERE "module_code" = 'supply-chain'
  AND "deleted_at" IS NULL;

UPDATE "modules"
SET "lifecycle_status" = 'DEVELOPMENT'
WHERE "module_type" = 'product'
  AND "module_code" <> 'supply-chain'
  AND "deleted_at" IS NULL;

-- Admin catalogue modules are not customer workspace entitlements.
UPDATE "modules"
SET "lifecycle_status" = 'INTERNAL'
WHERE "module_type" = 'admin'
  AND "deleted_at" IS NULL;

-- Deactivate company entitlements for non-AVAILABLE product modules.
UPDATE "company_modules" cm
SET
  "is_active" = false,
  "updated_at" = NOW()
FROM "modules" m
WHERE cm."module_id" = m."module_id"
  AND cm."deleted_at" IS NULL
  AND m."module_type" = 'product'
  AND m."lifecycle_status" NOT IN ('AVAILABLE', 'DEPRECATED');
