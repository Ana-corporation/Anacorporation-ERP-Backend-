-- Role status (ACTIVE | INACTIVE) + assignment history fields on user_roles.
-- Partial unique indexes allow multiple historical periods for the same trio.

CREATE TYPE "role_status" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "status" "role_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "deactivated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deactivated_by" BIGINT;

CREATE INDEX IF NOT EXISTS "roles_company_id_status_idx"
  ON "roles" ("company_id", "status");

ALTER TABLE "user_roles"
  ADD COLUMN IF NOT EXISTS "ended_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ended_by" BIGINT,
  ADD COLUMN IF NOT EXISTS "end_reason" VARCHAR(40);

-- Drop full unique so ended periods can coexist with a later re-hire of same trio.
ALTER TABLE "user_roles"
  DROP CONSTRAINT IF EXISTS "user_roles_user_id_company_id_role_id_key";

DROP INDEX IF EXISTS "user_roles_user_id_company_id_role_id_key";

-- At most one ACTIVE assignment per user per company (primary role model).
CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_one_active_per_user_company_uidx"
  ON "user_roles" ("user_id", "company_id")
  WHERE "is_active" = true;

-- At most one ACTIVE row per (user, company, role).
CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_active_user_company_role_uidx"
  ON "user_roles" ("user_id", "company_id", "role_id")
  WHERE "is_active" = true;

CREATE INDEX IF NOT EXISTS "user_roles_company_id_role_id_is_active_idx"
  ON "user_roles" ("company_id", "role_id", "is_active");

-- Backfill: mark inactive assignments as ended if missing ended_at.
UPDATE "user_roles"
SET
  "ended_at" = COALESCE("ended_at", "created_at"),
  "end_reason" = COALESCE("end_reason", 'UNASSIGNED')
WHERE "is_active" = false
  AND "ended_at" IS NULL;
