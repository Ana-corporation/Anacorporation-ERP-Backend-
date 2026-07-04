import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

export function getRedisConnectionOptions(
  configService: ConfigService,
): RedisOptions {
  return {
    host: configService.get<string>('redis.host'),
    port: configService.get<number>('redis.port'),
    password: configService.get<string>('redis.password'),
    db: configService.get<number>('redis.db'),
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 3000,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  };
}

export function getRedisConnectionOptionsFromEnv(): RedisOptions {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
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
