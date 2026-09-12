/**
 * Load .env and set DATABASE_URL / DIRECT_DATABASE_URL from GCP_SQL_*.
 * Prisma CLI and seed scripts require this before they open a connection.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function isNeonDatabaseUrl(url) {
  return /neon\.tech|\bneondb\b/i.test(String(url || ''));
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
    return;
  }

  if (isNeonDatabaseUrl(process.env.DATABASE_URL)) {
    throw new Error('Neon DATABASE_URL is not supported. Set GCP_SQL_* credentials for Cloud SQL.');
  }
}

applyGcpSqlDatabaseUrl();
