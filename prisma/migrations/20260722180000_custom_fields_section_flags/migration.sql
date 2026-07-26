-- AlterTable
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "section_key" VARCHAR(40);
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "placeholder" VARCHAR(255);
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "help_text" VARCHAR(500);
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "description" VARCHAR(1000);
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "is_read_only" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "is_hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "is_searchable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "is_sortable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "is_exportable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "is_printable" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "custom_field_definitions_company_id_entity_type_section_key_idx"
  ON "custom_field_definitions"("company_id", "entity_type", "section_key");
