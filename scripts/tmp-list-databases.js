require('./apply-gcp-sql-env');
const { spawnSync } = require('child_process');
const user = process.env.GCP_SQL_USER;
const password = process.env.GCP_SQL_PASSWORD;
process.env.PG_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@host.docker.internal:5432/swenter-dev?sslmode=disable`;
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-e',
    'PG_URL',
    'postgres:18-alpine',
    'sh',
    '-c',
    'psql "$PG_URL" -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY 1;" && echo "--- SCHEMAS in swenter-dev ---" && psql "$PG_URL" -c "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE \'pg_%\' AND nspname <> \'information_schema\' ORDER BY 1;"',
  ],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
