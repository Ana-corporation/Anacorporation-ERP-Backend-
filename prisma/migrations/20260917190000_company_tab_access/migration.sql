-- Company-level role visibility for form tabs (separate from role_permissions).

CREATE TABLE IF NOT EXISTS "company_tab_access" (
  "access_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "module_code" VARCHAR(40) NOT NULL,
  "entity_type" VARCHAR(40) NOT NULL,
  "tab_key" VARCHAR(80) NOT NULL,
  "role_id" BIGINT NOT NULL,
  "is_visible" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_tab_access_pkey" PRIMARY KEY ("access_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_tab_access_company_entity_tab_role_uidx"
  ON "company_tab_access" ("company_id", "entity_type", "tab_key", "role_id");

CREATE INDEX IF NOT EXISTS "company_tab_access_company_entity_idx"
  ON "company_tab_access" ("company_id", "entity_type");

CREATE INDEX IF NOT EXISTS "company_tab_access_company_entity_tab_idx"
  ON "company_tab_access" ("company_id", "entity_type", "tab_key");

CREATE INDEX IF NOT EXISTS "company_tab_access_role_id_idx"
  ON "company_tab_access" ("role_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_tab_access_company_id_fkey'
  ) THEN
    ALTER TABLE "company_tab_access"
      ADD CONSTRAINT "company_tab_access_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("company_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_tab_access_role_id_fkey'
  ) THEN
    ALTER TABLE "company_tab_access"
      ADD CONSTRAINT "company_tab_access_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("role_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
