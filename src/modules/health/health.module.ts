import { Module, Controller, Get } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { Public } from '@/common/decorators/auth.decorators';

@Controller('health')
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check() {
    const dbStart = Date.now();
    const dbOk = await this.prisma.isHealthy();
    const dbLatencyMs = Date.now() - dbStart;
    const redisOk = await this.redis.ping();

    return {
      status: dbOk ? 'ok' : 'degraded',
      database: dbOk ? 'connected' : 'disconnected',
      databaseLatencyMs: dbLatencyMs,
      redis: this.redis.isMemoryMode() ? 'memory (dev)' : redisOk ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
