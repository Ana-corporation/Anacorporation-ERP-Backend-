/** Build Prisma URLs from GCP Cloud SQL env. Neon URLs are never used. */

export function isNeonDatabaseUrl(url: string): boolean {
  return /neon\.tech|\bneondb\b/i.test(url);
}

function isCloudRun(config: Record<string, unknown>): boolean {
  return Boolean(config.K_SERVICE || process.env.K_SERVICE);
}

function unixSocketUrl(
  user: string,
  password: string,
  database: string,
  instance: string,
  schema: string,
): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost/${encodeURIComponent(database)}?host=/cloudsql/${instance}&schema=${encodeURIComponent(schema)}`;
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

  const onCloudRun = isCloudRun(config);
  const instance = String(config.GCP_SQL_INSTANCE_CONNECTION_NAME || '').trim();
  const publicIp = String(config.GCP_SQL_IP || '').trim();
  const user = String(config.GCP_SQL_USER || config.GCP_SQL_DATABASE || '');
  const password = String(config.GCP_SQL_PASSWORD || '');
  const database = String(config.GCP_SQL_DATABASE || '');
  const schema = String(config.GCP_SQL_SCHEMA || 'Erp_test_db');
  const current = String(config.DATABASE_URL || '');

  if (onCloudRun && instance && user && password && database) {
    const url = unixSocketUrl(user, password, database, instance, schema);
    config.DATABASE_URL = url;
    config.DIRECT_DATABASE_URL = url;
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
      (config.GOOGLE_APPLICATION_CREDENTIALS || config.GCP_SQL_INSTANCE_CONNECTION_NAME),
  );
  const host = publicIp || (usesProxy ? '127.0.0.1' : '');
  const port = String(config.GCP_SQL_PORT || '5432');
  const sslmode = String(config.GCP_SQL_SSL_MODE || (usesProxy ? 'disable' : 'require'));
  const timeout = String(config.GCP_SQL_CONNECT_TIMEOUT || '30');
  const canBuild = Boolean(user && password && host && database);
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
