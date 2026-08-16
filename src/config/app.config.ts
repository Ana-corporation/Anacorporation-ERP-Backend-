function parseCorsOrigin(): string | string[] {
  const raw = process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:3001';
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 1 ? origins : (origins[0] ?? 'http://localhost:3001');
}

export const appConfig = () => ({
  name: process.env.APP_NAME || 'ERP Backend',
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3002', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigin: parseCorsOrigin(),
});
