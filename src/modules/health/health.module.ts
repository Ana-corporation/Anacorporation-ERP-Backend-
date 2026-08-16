import { Module, Controller, Get } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { Public } from '@/common/decorators/auth.decorators';

@Controller()
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  async check() {
    const dbStart = Date.now();
    let dbOk = false;
    try {
      // PrismaService is an extended PrismaClient (constructor returns the client),
      // so class methods like isHealthy() are not on the instance.
      await this.prisma.$queryRaw`SELECT 1`;
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

  @Public()
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
