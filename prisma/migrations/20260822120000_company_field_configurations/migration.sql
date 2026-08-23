-- Built-in field configuration: company-level visibility overrides (override model).

CREATE TABLE IF NOT EXISTS "company_field_configurations" (
  "configuration_id" BIGSERIAL NOT NULL,
  "company_id" BIGINT NOT NULL,
  "entity_type" VARCHAR(40) NOT NULL,
  "field_key" VARCHAR(80) NOT NULL,
  "is_visible" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_field_configurations_pkey" PRIMARY KEY ("configuration_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_field_configurations_company_entity_field_uidx"
  ON "company_field_configurations" ("company_id", "entity_type", "field_key");

CREATE INDEX IF NOT EXISTS "company_field_configurations_company_entity_idx"
  ON "company_field_configurations" ("company_id", "entity_type");

ALTER TABLE "company_field_configurations"
  ADD CONSTRAINT "company_field_configurations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
