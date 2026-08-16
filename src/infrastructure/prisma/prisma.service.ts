import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const TRANSIENT_DB_ERROR_CODES = new Set(['P1001', 'P1002', 'P1017']);

function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (TRANSIENT_DB_ERROR_CODES.has(code)) return true;

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Can't reach database server") ||
    message.includes('Connection reset') ||
    message.includes('Connection refused') ||
    message.includes('Server has closed the connection')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrismaClient() {
  const base = new PrismaClient();

  return base.$extends({
    client: {
      async isHealthy() {
        try {
          await base.$queryRaw`SELECT 1`;
          return true;
        } catch {
          return false;
        }
      },
    },
    query: {
      async $allOperations({ args, query }) {
        const maxAttempts = 4;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            if (!isTransientDbError(error) || attempt === maxAttempts) {
              throw error;
            }

            // Neon free-tier cold start / brief pooler blip
            await delay(attempt * 1500);
            try {
              await base.$connect();
            } catch {
              // connect retry is best-effort; next query attempt will surface a real error
            }
          }
        }

        // Unreachable — loop always returns or throws
        throw new Error('Database operation failed after retries');
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const ExtendedPrismaClientHost = class {
  constructor() {
    return createPrismaClient();
  }
} as unknown as new () => ExtendedPrismaClient;

@Injectable()
export class PrismaService
  extends ExtendedPrismaClientHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async connectWithRetry(maxAttempts = 5): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        const isNeon = (process.env.DATABASE_URL ?? '').includes('neon.tech');
        this.logger.log(isNeon ? 'Neon database connected' : 'Database connected');
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Database connect attempt ${attempt}/${maxAttempts} failed: ${message}`);

        if (attempt === maxAttempts) {
          throw error;
        }

        // Neon cold start can take a few seconds on free tier
        await delay(attempt * 2000);
      }
    }
  }
}
