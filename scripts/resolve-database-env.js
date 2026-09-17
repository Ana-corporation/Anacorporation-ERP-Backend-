/**
 * Startup-only database selection for Nest + Prisma CLI.
 * Never call this per HTTP request.
 *
 * Development → DATABASE_URL = DEV_DATABASE_URL (Erp_test_db)
 * Production  → DATABASE_URL = PROD_DATABASE_URL (Ana_corporation_db)
 *
 * Fallback: existing GCP_SQL_* builder (Cloud Run / legacy .env).
 */
const fs = require('fs');
const path = require('path');

function isNeonDatabaseUrl(url) {
  return /neon\.tech|\bneondb\b/i.test(String(url || ''));
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Do not override values already set by the process / CI / Cloud Run
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadAppEnvFiles() {
  const root = path.join(__dirname, '..');
  const nodeEnv = String(process.env.NODE_ENV || 'development').trim();

  // Prefer environment-specific file, then shared .env fallback
  parseEnvFile(path.join(root, `.env.${nodeEnv}`));
  parseEnvFile(path.join(root, '.env'));
}

function applyGcpSqlDatabaseUrl() {
  if (isNeonDatabaseUrl(process.env.DATABASE_URL)) {
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_DATABASE_URL;
  }

  const onCloudRun = Boolean(process.env.K_SERVICE);
  const instance = String(process.env.GCP_SQL_INSTANCE_CONNECTION_NAME || '').trim();
  const publicIp = String(process.env.GCP_SQL_IP || '').trim();
  const user = process.env.GCP_SQL_USER || process.env.GCP_SQL_DATABASE || '';
  const password = process.env.GCP_SQL_PASSWORD || '';
  const database = process.env.GCP_SQL_DATABASE || '';
  const schema = process.env.GCP_SQL_SCHEMA || 'Erp_test_db';
  const current = String(process.env.DATABASE_URL || '');

  if (onCloudRun && instance && user && password && database) {
    const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost/${encodeURIComponent(database)}?host=/cloudsql/${instance}&schema=${encodeURIComponent(schema)}`;
    process.env.DATABASE_URL = url;
    process.env.DIRECT_DATABASE_URL = url;
    return;
  }

  if (current.includes('/cloudsql/')) {
    return;
  }

  const usesProxy = Boolean(
    !onCloudRun &&
      !publicIp &&
      (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCP_SQL_INSTANCE_CONNECTION_NAME),
  );
  const host = publicIp || (usesProxy ? '127.0.0.1' : '');
  const port = process.env.GCP_SQL_PORT || '5432';
  const sslmode = process.env.GCP_SQL_SSL_MODE || (usesProxy ? 'disable' : 'require');
  const timeout = process.env.GCP_SQL_CONNECT_TIMEOUT || '30';

  if (user && password && host && database) {
    const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=${encodeURIComponent(schema)}&sslmode=${sslmode}&connect_timeout=${timeout}`;
    process.env.DATABASE_URL = url;
    process.env.DIRECT_DATABASE_URL = url;
  }
}

/**
 * @returns {{ nodeEnv: string, dbLabel: 'DEV' | 'PROD' }}
 */
function resolveDatabaseEnv() {
  loadAppEnvFiles();

  const nodeEnv = String(process.env.NODE_ENV || 'development').trim();
  const onCloudRun = Boolean(process.env.K_SERVICE);
  const isProd = nodeEnv === 'production' || onCloudRun;
  const dbLabel = isProd ? 'PROD' : 'DEV';

  const selected = isProd
    ? String(process.env.PROD_DATABASE_URL || '').trim()
    : String(process.env.DEV_DATABASE_URL || '').trim();

  if (selected) {
    if (isNeonDatabaseUrl(selected)) {
      throw new Error('Neon database URLs are not supported. Use Cloud SQL URLs only.');
    }
    process.env.DATABASE_URL = selected;
    process.env.DIRECT_DATABASE_URL =
      String(process.env.DIRECT_DATABASE_URL || '').trim() || selected;
  } else {
    // Cloud Run / legacy: build from GCP_SQL_* (schema in that env selects Erp_test_db vs Ana_corporation_db)
    applyGcpSqlDatabaseUrl();
  }

  process.env.APP_DB_LABEL = dbLabel;
  return { nodeEnv: isProd ? 'production' : nodeEnv || 'development', dbLabel };
}

function logDatabaseTarget(logFn = console.log) {
  const nodeEnv = String(process.env.NODE_ENV || 'development');
  const dbLabel = String(process.env.APP_DB_LABEL || (nodeEnv === 'production' || process.env.K_SERVICE ? 'PROD' : 'DEV'));
  logFn(`Environment: ${nodeEnv === 'production' || process.env.K_SERVICE ? 'production' : 'development'}`);
  logFn(`Database: ${dbLabel}`);
}

module.exports = {
  loadAppEnvFiles,
  resolveDatabaseEnv,
  logDatabaseTarget,
  applyGcpSqlDatabaseUrl,
};
