/**
 * Create schema "Ana_corporation_db" inside database swenter-dev
 * with the same tables as Erp_test_db, but no business rows.
 */
require('./apply-gcp-sql-env');

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const user = process.env.GCP_SQL_USER;
const password = process.env.GCP_SQL_PASSWORD;
const sourceSchema = process.env.GCP_SQL_SCHEMA || 'Erp_test_db';
const destSchema = 'Ana_corporation_db';
const dumpDir = path.join(__dirname, '..', '.migrate-tmp');
fs.mkdirSync(dumpDir, { recursive: true });

process.env.PG_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@host.docker.internal:5432/swenter-dev?sslmode=disable`;

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
    [
      `pg_dump "$PG_URL" --schema-only --no-owner --no-acl -n '"${sourceSchema}"' -f /dump/ana-schema-copy.sql`,
      `sed -i 's/"${sourceSchema}"/"${destSchema}"/g' /dump/ana-schema-copy.sql`,
      `psql "$PG_URL" -v ON_ERROR_STOP=1 -f /dump/ana-schema-copy.sql`,
      `psql "$PG_URL" -c "SELECT n.nspname AS schema, count(*) FILTER (WHERE c.relkind = 'r') AS tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('${sourceSchema}','${destSchema}') GROUP BY 1 ORDER BY 1;"`,
    ].join(' && '),
  ],
  { stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
