-- role_type (SYSTEM | CUSTOM) mirrored from is_system for FE contract.

CREATE TYPE "role_type" AS ENUM ('SYSTEM', 'CUSTOM');

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "role_type" "role_type" NOT NULL DEFAULT 'CUSTOM';

UPDATE "roles"
SET "role_type" = 'SYSTEM'
WHERE "is_system" = true;

UPDATE "roles"
SET "role_type" = 'CUSTOM'
WHERE "is_system" = false;
