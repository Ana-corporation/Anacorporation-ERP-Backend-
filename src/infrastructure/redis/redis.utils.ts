import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

function normalizeRedisHost(host: string | undefined): string {
  // Windows resolves "localhost" to ::1 first; Redis in Docker usually listens on IPv4.
  const h = host || '127.0.0.1';
  return h === 'localhost' ? '127.0.0.1' : h;
}

export function getRedisConnectionOptions(
  configService: ConfigService,
): RedisOptions {
  return {
    host: normalizeRedisHost(configService.get<string>('redis.host')),
    port: configService.get<number>('redis.port'),
    password: configService.get<string>('redis.password'),
    db: configService.get<number>('redis.db'),
    family: 4,
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 3000,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  };
}

export function getRedisConnectionOptionsFromEnv(): RedisOptions {
  return {
    host: normalizeRedisHost(process.env.REDIS_HOST),
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    family: 4,
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 3000,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  };
}

export async function probeRedisAvailability(
  options: RedisOptions,
): Promise<boolean> {
  const client = new Redis({
    ...options,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });

  client.on('error', () => {
    // Suppress ioredis unhandled error events during the probe.
  });

  try {
    await client.connect();
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  } finally {
    await client.quit().catch(() => undefined);
  }
}
