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

  @ApiProperty({ example: 'swenter-dev', description: 'Postgres database from the live connection' })
  database!: string;

  @ApiProperty({
    example: 'Ana_corporation_db',
    description: 'Prisma schema currently in use (current_schema / DATABASE_URL / GCP_SQL_SCHEMA)',
  })
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

function parseDatabaseUrl(raw = String(process.env.DATABASE_URL || '')) {
  try {
    const url = new URL(raw);
    return {
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      schema: url.searchParams.get('schema') || '',
      host: url.searchParams.get('host') || url.hostname,
      port: url.port || '5432',
    };
  } catch {
    return { database: '', schema: '', host: '', port: '' };
  }
}

function connectionName(): string {
  const instance = String(process.env.GCP_SQL_INSTANCE_CONNECTION_NAME || '').trim();
  if (instance) return instance;
  const parsed = parseDatabaseUrl();
  if (parsed.host.startsWith('/cloudsql/')) return parsed.host.slice('/cloudsql/'.length);
  if (parsed.host) return `${parsed.host}:${parsed.port}`;
  return 'unknown';
}

function configuredDatabaseTarget() {
  const parsed = parseDatabaseUrl();
  return {
    database: String(process.env.GCP_SQL_DATABASE || '').trim() || parsed.database,
    schema: String(process.env.GCP_SQL_SCHEMA || '').trim() || parsed.schema,
  };
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
    const configured = configuredDatabaseTarget();
    const base = {
      connectionName: connectionName(),
      database: configured.database,
      schemaName: configured.schema,
    };

    try {
      const live = await withTimeout(
        this.prisma.$queryRaw<Array<{ database: string; schema: string }>>`
          SELECT current_database() AS database, current_schema() AS schema
        `,
        DB_PING_TIMEOUT_MS,
      );
      const database = String(live[0]?.database || configured.database);
      const schemaName = String(live[0]?.schema || configured.schema);
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
        connectionName: connectionName(),
        database,
        schemaName,
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
