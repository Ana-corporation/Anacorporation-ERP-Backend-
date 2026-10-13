-- One default inventory location per site (was one per company in the service).
-- Safety: if a site already has several defaults, keep the oldest one.
UPDATE "warehouses" w
SET "is_default" = false, "updated_at" = now()
WHERE w."is_default" = true
  AND w."deleted_at" IS NULL
  AND w."branch_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "warehouses" o
    WHERE o."branch_id" = w."branch_id"
      AND o."is_default" = true
      AND o."deleted_at" IS NULL
      AND o."warehouse_id" < w."warehouse_id"
  );

CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_branch_default_uidx"
  ON "warehouses" ("branch_id")
  WHERE "is_default" = true AND "deleted_at" IS NULL;
