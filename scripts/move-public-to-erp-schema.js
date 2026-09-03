/**
 * Move all public tables/sequences/enums into GCP_SQL_SCHEMA (default Erp_test_db).
 * Requires Cloud SQL Auth Proxy on 127.0.0.1:5432.
 */
require('./apply-gcp-sql-env');

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const schema = (process.env.GCP_SQL_SCHEMA || 'Erp_test_db').replace(/"/g, '');
const dumpDir = path.join(__dirname, '..', '.migrate-tmp');
fs.mkdirSync(dumpDir, { recursive: true });

const sqlPath = path.join(dumpDir, 'move-schema.sql');
fs.writeFileSync(
  sqlPath,
  `
CREATE SCHEMA IF NOT EXISTS "${schema}";
GRANT ALL ON SCHEMA "${schema}" TO CURRENT_USER;

DO $$
DECLARE
  r record;
  dest constant text := '${schema.replace(/'/g, "''")}';
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', r.tablename, dest);
  END LOOP;

  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I SET SCHEMA %I', r.sequence_name, dest);
  END LOOP;

  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE public.%I SET SCHEMA %I', r.typname, dest);
  END LOOP;

  FOR r IN SELECT table_name FROM information_schema.views WHERE table_schema = 'public'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET SCHEMA %I', r.table_name, dest);
  END LOOP;

  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I SET search_path TO %I, public',
    current_user,
    current_database(),
    dest
  );
END $$;
`,
);

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('schema');
url.searchParams.delete('connection_limit');
url.searchParams.delete('pgbouncer');
url.searchParams.delete('pool_timeout');
url.hostname = 'host.docker.internal';
process.env.PG_URL = url.toString();

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-e',
    'PG_URL',
    '-v',
    `${dumpDir}:/dump`,
    'postgres:18-alpine',
    'sh',
    '-c',
    'psql "$PG_URL" -v ON_ERROR_STOP=1 -f /dump/move-schema.sql && psql "$PG_URL" -c "SELECT n.nspname AS schema, count(*) FILTER (WHERE c.relkind = \'r\') AS tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN (\'pg_catalog\',\'information_schema\') GROUP BY 1 ORDER BY 1;"',
  ],
  { stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
