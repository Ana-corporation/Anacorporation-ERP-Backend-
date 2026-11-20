-- Mechanical / made parts: RM + one process category (PLT, MCN, FAB, SPR, …) = two part numbers.
-- Many SF-stage categories are allowed per company (one per process). FF uniqueness stays
-- (optional / unused for mechanical parts).

DROP INDEX IF EXISTS "item_groups_company_stage_uidx";
CREATE UNIQUE INDEX "item_groups_company_ff_stage_uidx"
  ON "item_groups"("company_id", "material_stage")
  WHERE "material_stage" = 'FF' AND "deleted_at" IS NULL;

-- Rollback:
--   DROP INDEX IF EXISTS "item_groups_company_ff_stage_uidx";
--   CREATE UNIQUE INDEX "item_groups_company_stage_uidx"
--     ON "item_groups"("company_id", "material_stage")
--     WHERE "material_stage" IN ('SF', 'FF') AND "deleted_at" IS NULL;
