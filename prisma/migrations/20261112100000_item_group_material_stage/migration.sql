-- Category stage for made parts: RM (raw) / SF (semi-finished) / FF (finished).
-- Items of an RM-stage category can get linked SF / FF items, created in the company's SF / FF
-- stage categories (one SF and one FF category per company).

ALTER TABLE "item_groups" ADD COLUMN "material_stage" VARCHAR(2);
ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_material_stage_check"
  CHECK ("material_stage" IS NULL OR "material_stage" IN ('RM', 'SF', 'FF'));
CREATE UNIQUE INDEX "item_groups_company_stage_uidx"
  ON "item_groups"("company_id", "material_stage")
  WHERE "material_stage" IN ('SF', 'FF') AND "deleted_at" IS NULL;

-- Existing data: a category takes the stage its items already have (only when all staged items
-- of the category share one stage, and only the first such category per company for SF / FF).
WITH staged AS (
  SELECT i."item_group_id", MIN(i."material_stage") AS stage
  FROM "items" i
  WHERE i."material_stage" IS NOT NULL AND i."item_group_id" IS NOT NULL AND i."deleted_at" IS NULL
  GROUP BY i."item_group_id"
  HAVING COUNT(DISTINCT i."material_stage") = 1
), ranked AS (
  SELECT g."item_group_id", s.stage,
         ROW_NUMBER() OVER (PARTITION BY g."company_id", s.stage ORDER BY g."item_group_id") AS n
  FROM "item_groups" g JOIN staged s ON s."item_group_id" = g."item_group_id"
  WHERE g."deleted_at" IS NULL
)
UPDATE "item_groups" g SET "material_stage" = r.stage
FROM ranked r
WHERE g."item_group_id" = r."item_group_id" AND (r.stage = 'RM' OR r.n = 1);

-- Rollback:
--   DROP INDEX "item_groups_company_stage_uidx";
--   ALTER TABLE "item_groups" DROP CONSTRAINT "item_groups_material_stage_check";
--   ALTER TABLE "item_groups" DROP COLUMN "material_stage";
