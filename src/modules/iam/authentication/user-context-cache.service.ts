import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { AUTH_REDIS_KEYS } from './auth-session.types';

@Injectable()
export class UserContextCacheService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    configService: ConfigService,
  ) {
    this.ttlSeconds = Number(configService.get<string>('PERMISSION_CACHE_TTL_SECONDS') ?? 300);
  }

  async get(userId: string, companyId: string): Promise<AuthenticatedUser | null> {
    return this.redisService.getJson<AuthenticatedUser>(
      AUTH_REDIS_KEYS.userContext(userId, companyId),
    );
  }

  async set(userId: string, companyId: string, context: AuthenticatedUser) {
    await this.redisService.setJson(
      AUTH_REDIS_KEYS.userContext(userId, companyId),
      context,
      this.ttlSeconds,
    );
  }

  async invalidate(userId: string, companyId?: string) {
    if (companyId) {
      await this.redisService.del(AUTH_REDIS_KEYS.userContext(userId, companyId));
      return;
    }

    // Best-effort: invalidate known company scope only (no key scan).
    // Callers should pass companyId when known.
  }
}
