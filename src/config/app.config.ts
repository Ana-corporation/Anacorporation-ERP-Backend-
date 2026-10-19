const LIVE_FRONTEND_ORIGINS = [
  'https://anacorporation-erp-frontend-983704016599.europe-west1.run.app',
  'https://swenter.com',
  'https://www.swenter.com',
];

function splitOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function parseCorsOrigin(): string[] {
  const raw = process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || '';
  const origins = [
    ...splitOrigins(raw),
    'http://localhost:3001',
    ...LIVE_FRONTEND_ORIGINS,
  ].filter(Boolean);
  return [...new Set(origins)];
}

/** One site for emailed links. A comma-separated CORS list must not be used as the URL. */
function resolveFrontendOrigin(): string {
  const origins = splitOrigins(process.env.FRONTEND_ORIGIN || 'http://localhost:3001');
  return origins.find((origin) => origin === 'https://swenter.com') || origins[0] || 'http://localhost:3001';
}

export const appConfig = () => ({
  name: process.env.APP_NAME || 'ERP Backend',
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3002', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigin: parseCorsOrigin(),
  frontendOrigin: resolveFrontendOrigin(),
  schedulerSecret: process.env.SCHEDULER_SECRET,
});
