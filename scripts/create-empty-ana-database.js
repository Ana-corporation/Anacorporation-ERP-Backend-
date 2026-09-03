/**
 * Create database Ana_corporation_db with the same table structure as
 * swenter-dev / Erp_test_db, but no business data.
 * Copies _prisma_migrations rows so Prisma does not re-apply migrations.
 */
require('./apply-gcp-sql-env');

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const user = process.env.GCP_SQL_USER;
const password = process.env.GCP_SQL_PASSWORD;
const schema = process.env.GCP_SQL_SCHEMA || 'Erp_test_db';
const sourceDb = process.env.GCP_SQL_DATABASE || 'swenter-dev';
const targetDb = process.env.GCP_SQL_EMPTY_DATABASE || 'Ana_corporation_db';
const dumpDir = path.join(__dirname, '..', '.migrate-tmp');

function libpqUrl(database) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@host.docker.internal:5432/${encodeURIComponent(database)}?sslmode=disable`;
}

function runDocker(argsInside, extraEnv) {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      'ADMIN_URL',
      '-e',
      'SOURCE_URL',
      '-e',
      'TARGET_URL',
      '-v',
      `${dumpDir}:/dump`,
      'postgres:18-alpine',
      'sh',
      '-c',
      argsInside,
    ],
    { stdio: 'inherit', env: { ...process.env, ...extraEnv } },
  );
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

fs.mkdirSync(dumpDir, { recursive: true });

const extraEnv = {
  ADMIN_URL: libpqUrl(sourceDb),
  SOURCE_URL: libpqUrl(sourceDb),
  TARGET_URL: libpqUrl(targetDb),
};

const createSql = `CREATE DATABASE "${targetDb.replace(/"/g, '')}" OWNER "${user.replace(/"/g, '')}";`;
fs.writeFileSync(path.join(dumpDir, 'create-ana-db.sql'), createSql);

let status = runDocker(
  `exists=$(psql "$ADMIN_URL" -Atqc "SELECT 1 FROM pg_database WHERE datname = '${targetDb.replace(/'/g, "''")}'"); if [ "$exists" = "1" ]; then echo "database already exists"; else psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f /dump/create-ana-db.sql; fi`,
  extraEnv,
);
if (status !== 0) {
  process.exit(status);
}

status = runDocker(
  `pg_dump "$SOURCE_URL" --schema-only --no-owner --no-acl -n '"${schema}"' -f /dump/ana-schema.sql && psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f /dump/ana-schema.sql`,
  extraEnv,
);
if (status !== 0) {
  process.exit(status);
}

status = runDocker(
  `pg_dump "$SOURCE_URL" --data-only --no-owner --no-acl -t '"${schema}"._prisma_migrations' -f /dump/ana-migrations.sql && psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f /dump/ana-migrations.sql`,
  extraEnv,
);
if (status !== 0) {
  process.exit(status);
}

status = runDocker(
  `psql "$TARGET_URL" -c "SELECT current_database() AS db, (SELECT count(*) FROM information_schema.tables WHERE table_schema = '${schema.replace(/'/g, "''")}') AS tables, (SELECT COALESCE(sum(n_live_tup),0) FROM pg_stat_user_tables WHERE schemaname = '${schema.replace(/'/g, "''")}' AND relname <> '_prisma_migrations') AS business_rows;"`,
  extraEnv,
);

process.exit(status);
