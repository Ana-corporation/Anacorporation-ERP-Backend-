import { Module, Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { Public } from '@/common/decorators/auth.decorators';

const DB_PING_TIMEOUT_MS = 1500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

class DatabaseHealthDto {
  @ApiProperty({ example: 'project:region:swenter-db-dev' })
  connectionName!: string;

  @ApiProperty({ example: 'swenter-dev' })
  database!: string;

  @ApiProperty({ example: 'Erp_test_db' })
  schemaName!: string;

  @ApiProperty({ example: 'connected', enum: ['connected', 'disconnected'] })
  connectionStatus!: 'connected' | 'disconnected';

  @ApiProperty({ example: 53 })
  tableCount!: number;

  @ApiProperty({ type: [String], example: ['companies', 'users'] })
  tables!: string[];

  @ApiProperty({ required: false })
  error?: string;
}

function connectionName(): string {
  const instance = String(process.env.GCP_SQL_INSTANCE_CONNECTION_NAME || '').trim();
  if (instance) return instance;
  const raw = String(process.env.DATABASE_URL || '');
  try {
    const url = new URL(raw);
    const socket = url.searchParams.get('host');
    if (socket?.startsWith('/cloudsql/')) return socket.slice('/cloudsql/'.length);
    return `${url.hostname}:${url.port || '5432'}`;
  } catch {
    return 'unknown';
  }
}

@ApiTags('Health')
@Public()
@Controller()
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('favicon.ico')
  @HttpCode(204)
  favicon() {
    return;
  }

  /** Cloud Run / load-balancer liveness — no I/O. */
  @Get('health/live')
  live() {
    return {
      status: 'ok',
      service: 'anacorporation-erp-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  async check() {
    const dbStart = Date.now();
    let dbOk = false;
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, DB_PING_TIMEOUT_MS);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const dbLatencyMs = Date.now() - dbStart;
    const sessionStore =
      typeof this.redis.getSessionStoreMode === 'function'
        ? this.redis.getSessionStoreMode()
        : 'memory-disk';
    const redisOk = sessionStore === 'redis' ? await this.redis.ping() : false;

    return {
      status: dbOk ? 'ok' : 'degraded',
      service: 'anacorporation-erp-backend',
      database: dbOk ? 'connected' : 'disconnected',
      databaseLatencyMs: dbLatencyMs,
      sessionStore,
      redisOk,
      redis: sessionStore === 'memory-disk' ? 'memory' : redisOk ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('api/v1/health')
  checkAlias() {
    return this.check();
  }

  @Get('health/database')
  @ApiOperation({ summary: 'Check Cloud SQL connection, schema, and tables' })
  @ApiOkResponse({ type: DatabaseHealthDto })
  databaseCheck() {
    return this.inspectDatabase();
  }

  @Get('api/v1/health/database')
  @ApiOperation({ summary: 'Check Cloud SQL connection, schema, and tables' })
  @ApiOkResponse({ type: DatabaseHealthDto })
  databaseCheckAlias() {
    return this.inspectDatabase();
  }

  private async inspectDatabase(): Promise<DatabaseHealthDto> {
    const schemaName = String(process.env.GCP_SQL_SCHEMA || 'Erp_test_db');
    const database = String(process.env.GCP_SQL_DATABASE || '');
    const base = {
      connectionName: connectionName(),
      database,
      schemaName,
    };

    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, DB_PING_TIMEOUT_MS);
      const rows = await withTimeout(
        this.prisma.$queryRaw<Array<{ table_name: string }>>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = ${schemaName}
            AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `,
        5000,
      );
      const tables = rows.map((row) => row.table_name);
      return {
        ...base,
        connectionStatus: 'connected',
        tableCount: tables.length,
        tables,
      };
    } catch (error) {
      return {
        ...base,
        connectionStatus: 'disconnected',
        tableCount: 0,
        tables: [],
        error: error instanceof Error ? error.message : 'Database unreachable',
      };
    }
  }
}

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
