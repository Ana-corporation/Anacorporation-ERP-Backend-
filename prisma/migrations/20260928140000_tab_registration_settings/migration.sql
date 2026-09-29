-- "Show on Registration Form" per form tab (company-level; the public vendor link has no role).

CREATE TABLE IF NOT EXISTS "company_tab_registration_settings" (
  "setting_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "entity_type" VARCHAR(40) NOT NULL,
  "tab_key" VARCHAR(80) NOT NULL,
  "is_registration_visible" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_tab_registration_settings_pkey" PRIMARY KEY ("setting_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_tab_registration_company_entity_tab_uidx"
  ON "company_tab_registration_settings" ("company_id", "entity_type", "tab_key");

CREATE INDEX IF NOT EXISTS "company_tab_registration_company_entity_idx"
  ON "company_tab_registration_settings" ("company_id", "entity_type");

ALTER TABLE "company_tab_registration_settings"
  ADD CONSTRAINT "company_tab_registration_settings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
