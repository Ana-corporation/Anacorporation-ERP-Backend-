-- Item Master setup: Item Group tree (per store category), UOM master, item links + image,
-- and Form Configuration mandatory / label overrides. No company data is seeded here.

-- CreateTable
CREATE TABLE "item_groups" (
    "item_group_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "store_category_id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "item_groups_pkey" PRIMARY KEY ("item_group_id"),
    CONSTRAINT "item_groups_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "item_group_id")
);

CREATE INDEX "item_groups_company_id_store_category_id_idx" ON "item_groups"("company_id", "store_category_id");
CREATE INDEX "item_groups_parent_id_idx" ON "item_groups"("parent_id");
CREATE UNIQUE INDEX "item_groups_sibling_name_uidx"
  ON "item_groups"("company_id", "store_category_id", COALESCE("parent_id", 0), lower("name"))
  WHERE "deleted_at" IS NULL;

ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_store_category_id_fkey" FOREIGN KEY ("store_category_id") REFERENCES "store_categories"("store_category_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "item_groups"("item_group_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "uoms" (
    "uom_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "uoms_pkey" PRIMARY KEY ("uom_id"),
    CONSTRAINT "uoms_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._/-]{0,19}$')
);

CREATE INDEX "uoms_company_id_idx" ON "uoms"("company_id");
CREATE UNIQUE INDEX "uoms_company_code_uidx" ON "uoms"("company_id", "code") WHERE "deleted_at" IS NULL;

ALTER TABLE "uoms" ADD CONSTRAINT "uoms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Items: links to the masters (nullable; existing items unchanged) + picture reference.
ALTER TABLE "items" ADD COLUMN "item_group_id" BIGINT;
ALTER TABLE "items" ADD COLUMN "inventory_uom_id" BIGINT;
ALTER TABLE "items" ADD COLUMN "image_file_asset_id" UUID;
CREATE INDEX "items_company_id_item_group_id_idx" ON "items"("company_id", "item_group_id");
CREATE INDEX "items_inventory_uom_id_idx" ON "items"("inventory_uom_id");
CREATE INDEX "items_company_description_lower_idx" ON "items"("company_id", lower("description"));
ALTER TABLE "items" ADD CONSTRAINT "items_item_group_id_fkey" FOREIGN KEY ("item_group_id") REFERENCES "item_groups"("item_group_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_inventory_uom_id_fkey" FOREIGN KEY ("inventory_uom_id") REFERENCES "uoms"("uom_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Form Configuration: per-company mandatory flag and label for built-in fields.
ALTER TABLE "company_field_configurations" ADD COLUMN "is_required" BOOLEAN;
ALTER TABLE "company_field_configurations" ADD COLUMN "label" VARCHAR(100);
