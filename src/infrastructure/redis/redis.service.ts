import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { getRedisConnectionOptions } from './redis.utils';

interface MemoryEntry {
  value: string;
  expiresAt?: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private useMemory: boolean;
  private client: Redis | null = null;
  private readonly memoryStore = new Map<string, MemoryEntry>();

  constructor(private readonly configService: ConfigService) {
    this.useMemory = this.configService.get<boolean>('redis.useMemory') ?? false;
  }

  async onModuleInit() {
    if (this.useMemory) {
      this.logger.warn('Session store: in-memory (USE_MEMORY_SESSION=true)');
      return;
    }

    this.client = new Redis(getRedisConnectionOptions(this.configService));
    this.client.on('error', () => {
      // Handled during connect/ping; prevents unhandled ioredis error spam.
    });

    try {
      await this.client.connect();
      await this.client.ping();
      this.logger.log('Session store: Redis connected');
    } catch {
      await this.client.quit().catch(() => undefined);
      this.client = null;
      this.useMemory = true;
      this.logger.warn(
        'Session store: Redis unavailable — using in-memory fallback. Start Docker Redis and set USE_MEMORY_SESSION=false for production.',
      );
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isMemoryMode(): boolean {
    return this.useMemory;
  }

  async ping(): Promise<boolean> {
    if (this.useMemory) return true;
    if (!this.client) return false;

    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.useMemory) {
      const entry = this.memoryStore.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        this.memoryStore.delete(key);
        return null;
      }
      return entry.value;
    }

    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.useMemory) {
      this.memoryStore.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
      });
      return;
    }

    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (this.useMemory) {
      this.memoryStore.delete(key);
      return;
    }

    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch {
      // ignore
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
