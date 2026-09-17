/**
 * Load environment and set DATABASE_URL for Prisma CLI / seeds.
 * Startup-only. Never use per HTTP request.
 */
const { resolveDatabaseEnv, logDatabaseTarget } = require('./resolve-database-env');

const { nodeEnv, dbLabel } = resolveDatabaseEnv();
logDatabaseTarget((msg) => {
  // Keep CLI output short and secret-free
  console.log(`[prisma-env] ${msg}`);
});

if (!process.env.DATABASE_URL) {
  console.error(
    `[prisma-env] DATABASE_URL is empty after resolve (NODE_ENV=${nodeEnv}, Database=${dbLabel}). ` +
      `Set DEV_DATABASE_URL or PROD_DATABASE_URL in .env.${nodeEnv === 'production' ? 'production' : 'development'}, ` +
      `or configure GCP_SQL_* for the Cloud SQL Auth Proxy fallback.`,
  );
}
