-- Manufacturing stage chain for made parts: RM (raw) -> SF (semi-finished) -> FF (finished).
-- Each stage is its own item (own part number + stock); previous_stage_item_id points back one stage.

ALTER TABLE "items" ADD COLUMN "material_stage" VARCHAR(2);
ALTER TABLE "items" ADD COLUMN "previous_stage_item_id" BIGINT;

ALTER TABLE "items" ADD CONSTRAINT "items_material_stage_check"
  CHECK ("material_stage" IS NULL OR "material_stage" IN ('RM', 'SF', 'FF'));

ALTER TABLE "items" ADD CONSTRAINT "items_previous_stage_not_self"
  CHECK ("previous_stage_item_id" IS NULL OR "previous_stage_item_id" <> "item_id");

CREATE UNIQUE INDEX "items_previous_stage_item_id_key" ON "items"("previous_stage_item_id");

ALTER TABLE "items" ADD CONSTRAINT "items_previous_stage_item_id_fkey"
  FOREIGN KEY ("previous_stage_item_id") REFERENCES "items"("item_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rollback:
--   ALTER TABLE "items" DROP CONSTRAINT "items_previous_stage_item_id_fkey";
--   DROP INDEX "items_previous_stage_item_id_key";
--   ALTER TABLE "items" DROP CONSTRAINT "items_previous_stage_not_self";
--   ALTER TABLE "items" DROP CONSTRAINT "items_material_stage_check";
--   ALTER TABLE "items" DROP COLUMN "previous_stage_item_id";
--   ALTER TABLE "items" DROP COLUMN "material_stage";
