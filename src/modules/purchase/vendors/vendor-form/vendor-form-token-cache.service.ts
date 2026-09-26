import { Injectable } from '@nestjs/common';
import { RedisService } from '@/infrastructure/redis/redis.service';

const KEY_PREFIX = 'vendor-form:token:';

@Injectable()
export class VendorFormTokenCacheService {
  constructor(private readonly redis: RedisService) {}

  private key(invitationId: string): string {
    return `${KEY_PREFIX}${invitationId}`;
  }

  async store(invitationId: string, rawToken: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    await this.redis.set(this.key(invitationId), rawToken, ttlSeconds);
  }

  async get(invitationId: string): Promise<string | null> {
    return this.redis.get(this.key(invitationId));
  }

  async delete(invitationId: string): Promise<void> {
    await this.redis.del(this.key(invitationId));
  }
}
