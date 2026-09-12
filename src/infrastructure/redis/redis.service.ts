import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { getRedisConnectionOptions } from './redis.utils';

interface MemoryEntry {
  value: string;
  expiresAt?: number;
}

/** Survives Nest hot-reload when Redis is unavailable (dev). */
const MEMORY_SESSION_FILE = path.join(process.cwd(), '.erp-memory-sessions.json');

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private useMemory: boolean;
  private client: Redis | null = null;
  private readonly memoryStore = new Map<string, MemoryEntry>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.useMemory = this.configService.get<boolean>('redis.useMemory') ?? false;
  }

  async onModuleInit() {
    const host = this.configService.get<string>('redis.host');
    const onCloudRun = Boolean(process.env.K_SERVICE);
    const localRedis =
      !host || host === '127.0.0.1' || host === 'localhost';
    if (this.useMemory || (onCloudRun && localRedis)) {
      this.useMemory = true;
      this.loadMemoryStoreFromDisk();
      this.logger.log('Session store: in-memory + disk persist (Redis off until REDIS_HOST is set)');
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
      this.loadMemoryStoreFromDisk();
      this.logger.warn(
        'Session store: REDIS_HOST set but Redis is unreachable — using in-memory + disk persist.',
      );
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isMemoryMode(): boolean {
    return this.useMemory;
  }

  /** For health / ops: how sessions are actually stored right now. */
  getSessionStoreMode(): 'redis' | 'memory-disk' {
    return this.useMemory ? 'memory-disk' : 'redis';
  }

  async ping(): Promise<boolean> {
    if (this.useMemory || !this.client) return false;

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
        this.schedulePersist();
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
      this.schedulePersist();
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
      this.schedulePersist();
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
    if (this.useMemory) {
      this.flushMemoryStoreToDisk();
    }
    if (this.client) {
      await this.client.quit();
    }
  }

  private loadMemoryStoreFromDisk() {
    try {
      if (!fs.existsSync(MEMORY_SESSION_FILE)) return;
      const raw = fs.readFileSync(MEMORY_SESSION_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, MemoryEntry>;
      const now = Date.now();
      let loaded = 0;
      for (const [key, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry.value !== 'string') continue;
        if (entry.expiresAt && entry.expiresAt < now) continue;
        this.memoryStore.set(key, entry);
        loaded += 1;
      }
      this.logger.log(`Restored ${loaded} session key(s) from disk`);
    } catch (error) {
      this.logger.warn(`Could not restore memory sessions: ${(error as Error).message}`);
    }
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushMemoryStoreToDisk(), 250);
  }

  private flushMemoryStoreToDisk() {
    try {
      const now = Date.now();
      const payload: Record<string, MemoryEntry> = {};
      for (const [key, entry] of this.memoryStore.entries()) {
        if (entry.expiresAt && entry.expiresAt < now) {
          this.memoryStore.delete(key);
          continue;
        }
        payload[key] = entry;
      }
      fs.writeFileSync(MEMORY_SESSION_FILE, JSON.stringify(payload), 'utf8');
    } catch (error) {
      this.logger.warn(`Could not persist memory sessions: ${(error as Error).message}`);
    }
  }
}
