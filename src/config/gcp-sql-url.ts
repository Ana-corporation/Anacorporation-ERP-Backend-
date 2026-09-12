/** Build Prisma URLs from GCP Cloud SQL env. Neon URLs are never used. */

export function isNeonDatabaseUrl(url: string): boolean {
  return /neon\.tech|\bneondb\b/i.test(url);
}

export function applyGcpSqlDatabaseUrl(
  config: Record<string, unknown> = process.env as Record<string, unknown>,
): void {
  const existing = typeof config.DATABASE_URL === 'string' ? config.DATABASE_URL : '';
  if (existing && isNeonDatabaseUrl(existing)) {
    delete config.DATABASE_URL;
    delete config.DIRECT_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_DATABASE_URL;
  }

  const publicIp = String(config.GCP_SQL_IP || '').trim();
  const usesProxy = Boolean(
    !publicIp &&
      (config.GOOGLE_APPLICATION_CREDENTIALS || config.GCP_SQL_INSTANCE_CONNECTION_NAME),
  );
  const user = String(config.GCP_SQL_USER || config.GCP_SQL_DATABASE || '');
  const password = String(config.GCP_SQL_PASSWORD || '');
  const host = publicIp || (usesProxy ? '127.0.0.1' : '');
  const port = String(config.GCP_SQL_PORT || '5432');
  const database = String(config.GCP_SQL_DATABASE || '');
  const sslmode = String(config.GCP_SQL_SSL_MODE || (usesProxy ? 'disable' : 'require'));
  const timeout = String(config.GCP_SQL_CONNECT_TIMEOUT || '30');
  const schema = String(config.GCP_SQL_SCHEMA || 'Erp_test_db');
  const canBuild = Boolean(user && password && host && database);
  const current = String(config.DATABASE_URL || '');
  const shouldBuild = canBuild && (!current || isNeonDatabaseUrl(current) || usesProxy);

  if (shouldBuild) {
    const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=${encodeURIComponent(schema)}&sslmode=${sslmode}&connect_timeout=${timeout}`;
    config.DATABASE_URL = url;
    config.DIRECT_DATABASE_URL = url;
    process.env.DATABASE_URL = url;
    process.env.DIRECT_DATABASE_URL = url;
    return;
  }

  const leftover = String(config.DATABASE_URL || process.env.DATABASE_URL || '');
  if (leftover && isNeonDatabaseUrl(leftover)) {
    throw new Error(
      'Neon DATABASE_URL is not supported. Set GCP_SQL_* credentials for Cloud SQL.',
    );
  }
}
