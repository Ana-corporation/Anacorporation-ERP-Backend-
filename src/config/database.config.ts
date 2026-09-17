import { resolveDatabaseEnv } from './resolve-database-env';

export const databaseConfig = () => {
  // Startup-only; never select DB from a request.
  resolveDatabaseEnv();
  return {
    url: process.env.DATABASE_URL,
  };
};
