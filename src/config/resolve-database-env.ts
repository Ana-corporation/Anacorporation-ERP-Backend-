/**
 * Nest bootstrap helper — startup-only DB selection.
 * Implementation lives in scripts/resolve-database-env.js (shared with Prisma CLI).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { existsSync } from 'fs';
import { join } from 'path';

function loadImpl(): {
  resolveDatabaseEnv: () => { nodeEnv: string; dbLabel: 'DEV' | 'PROD' };
  logDatabaseTarget: (logFn?: (msg: string) => void) => void;
  applyGcpSqlDatabaseUrl: () => void;
} {
  const scriptPath = join(process.cwd(), 'scripts', 'resolve-database-env.js');
  if (!existsSync(scriptPath)) {
    throw new Error(
      `Missing ${scriptPath}. Cloud Run image must include scripts/resolve-database-env.js.`,
    );
  }
  return require(scriptPath) as {
    resolveDatabaseEnv: () => { nodeEnv: string; dbLabel: 'DEV' | 'PROD' };
    logDatabaseTarget: (logFn?: (msg: string) => void) => void;
    applyGcpSqlDatabaseUrl: () => void;
  };
}

const impl = loadImpl();

export function resolveDatabaseEnv(): { nodeEnv: string; dbLabel: 'DEV' | 'PROD' } {
  return impl.resolveDatabaseEnv();
}

export function logDatabaseTarget(logFn?: (msg: string) => void): void {
  impl.logDatabaseTarget(logFn);
}

export function applyGcpSqlDatabaseUrl(): void {
  impl.applyGcpSqlDatabaseUrl();
}
