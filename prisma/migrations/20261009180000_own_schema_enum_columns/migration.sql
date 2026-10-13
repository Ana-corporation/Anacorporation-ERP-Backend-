-- Some enum columns were created pointing at another schema's enum type (e.g. LIVE
-- warehouses.location_type used "Erp_test_db".warehouse_location_type). Prisma casts values to
-- this schema's type, so inserts failed with 42804. Re-point such columns at the same-named type
-- in this schema (labels are identical). No-op where columns already use their own schema.
DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT c.table_name, c.column_name, c.udt_name, c.column_default
    FROM information_schema.columns c
    WHERE c.table_schema = current_schema()
      AND c.udt_schema <> current_schema()
      AND c.udt_schema NOT IN ('pg_catalog', 'information_schema')
      AND EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema() AND t.typname = c.udt_name AND t.typtype = 'e'
      )
  LOOP
    IF col.column_default IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', col.table_name, col.column_name);
    END IF;
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE %I.%I USING %I::text::%I.%I',
      col.table_name, col.column_name,
      current_schema(), col.udt_name,
      col.column_name, current_schema(), col.udt_name
    );
    -- Enum defaults look like 'X'::"Other_schema".type; keep only the 'X' literal.
    IF col.column_default IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s',
        col.table_name, col.column_name, split_part(col.column_default, '::', 1)
      );
    END IF;
  END LOOP;
END $$;

-- Matches @default(Store) in the Prisma schema (missing on LIVE).
ALTER TABLE "warehouses" ALTER COLUMN "location_type" SET DEFAULT 'Store';
