import { Module, Controller, Get } from '@nestjs/common';
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

@Public()
@Controller()
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

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
}

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
