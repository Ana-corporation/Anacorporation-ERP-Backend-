/**
 * Nest bootstrap helper — startup-only DB selection.
 * Implementation lives in scripts/resolve-database-env.js (shared with Prisma CLI).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { join } from 'path';

// Use the CommonJS script so Prisma CLI and Nest stay on one source of truth.
// Path works from ts-node (src/) and compiled dist/ when nest copies aren't used —
// always resolve from process.cwd()/scripts.
const impl = require(join(process.cwd(), 'scripts', 'resolve-database-env.js')) as {
  resolveDatabaseEnv: () => { nodeEnv: string; dbLabel: 'DEV' | 'PROD' };
  logDatabaseTarget: (logFn?: (msg: string) => void) => void;
  applyGcpSqlDatabaseUrl: () => void;
};

export function resolveDatabaseEnv(): { nodeEnv: string; dbLabel: 'DEV' | 'PROD' } {
  return impl.resolveDatabaseEnv();
}

export function logDatabaseTarget(logFn?: (msg: string) => void): void {
  impl.logDatabaseTarget(logFn);
}

export function applyGcpSqlDatabaseUrl(): void {
  impl.applyGcpSqlDatabaseUrl();
}
