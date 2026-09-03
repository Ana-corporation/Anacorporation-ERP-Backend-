import { applyGcpSqlDatabaseUrl } from './gcp-sql-url';

export const databaseConfig = () => {
  applyGcpSqlDatabaseUrl();
  return {
    url: process.env.DATABASE_URL,
  };
};
