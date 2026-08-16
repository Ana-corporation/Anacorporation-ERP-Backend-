const LIVE_FRONTEND_ORIGIN =
  'https://anacorporation-erp-frontend-983704016599.europe-west1.run.app';

function parseCorsOrigin(): string[] {
  const raw = process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || '';
  const origins = [
    ...raw.split(',').map((origin) => origin.trim().replace(/\/$/, '')),
    'http://localhost:3001',
    LIVE_FRONTEND_ORIGIN,
  ].filter(Boolean);
  return [...new Set(origins)];
}

export const appConfig = () => ({
  name: process.env.APP_NAME || 'ERP Backend',
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3002', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigin: parseCorsOrigin(),
});
