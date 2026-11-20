-- Item Group = Category master: part-number category code (BRG, PLY, ASSY) + examples / scope.
-- No company data is seeded here; see scripts/seed-ana-categories.ts.

ALTER TABLE "item_groups" ADD COLUMN "category_code" VARCHAR(4);
ALTER TABLE "item_groups" ADD COLUMN "description" VARCHAR(255);

ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_category_code_format"
  CHECK ("category_code" IS NULL OR "category_code" ~ '^[A-Z]{2,4}$');

CREATE UNIQUE INDEX "item_groups_company_category_code_uidx"
  ON "item_groups"("company_id", "category_code")
  WHERE "deleted_at" IS NULL AND "category_code" IS NOT NULL;
