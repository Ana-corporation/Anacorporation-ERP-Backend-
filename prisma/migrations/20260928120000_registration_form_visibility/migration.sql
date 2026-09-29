-- Separate "Show on Registration Form" setting for the public vendor registration form.

ALTER TABLE "company_field_configurations"
  ALTER COLUMN "is_visible" DROP NOT NULL;

ALTER TABLE "company_field_configurations"
  ADD COLUMN IF NOT EXISTS "is_registration_visible" BOOLEAN;

ALTER TABLE "custom_field_definitions"
  ADD COLUMN IF NOT EXISTS "is_registration_visible" BOOLEAN NOT NULL DEFAULT true;
