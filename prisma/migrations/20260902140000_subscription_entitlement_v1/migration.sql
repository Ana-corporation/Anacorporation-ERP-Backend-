-- Subscription & module entitlement v1

CREATE TYPE "company_module_override_action" AS ENUM ('GRANT', 'REVOKE');

CREATE TABLE "company_module_overrides" (
    "company_module_override_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "module_id" BIGINT NOT NULL,
    "action" "company_module_override_action" NOT NULL,
    "reason" VARCHAR(500),
    "expires_at" DATE,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "company_module_overrides_pkey" PRIMARY KEY ("company_module_override_id")
);

CREATE INDEX "company_module_overrides_company_id_idx" ON "company_module_overrides"("company_id");
CREATE INDEX "company_module_overrides_module_id_idx" ON "company_module_overrides"("module_id");

ALTER TABLE "company_module_overrides" ADD CONSTRAINT "company_module_overrides_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_module_overrides" ADD CONSTRAINT "company_module_overrides_module_id_fkey"
  FOREIGN KEY ("module_id") REFERENCES "modules"("module_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_subscriptions"
  ADD COLUMN IF NOT EXISTS "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);

ALTER TABLE "company_modules"
  ADD COLUMN IF NOT EXISTS "is_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "company_modules"
SET "is_enabled" = "is_active"
WHERE "is_enabled" IS DISTINCT FROM "is_active";
