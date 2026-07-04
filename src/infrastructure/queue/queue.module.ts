import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRedisConnectionOptions } from '@/infrastructure/redis/redis.utils';

export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  INVENTORY: 'inventory',
  REPORTS: 'reports',
} as const;

const logger = new Logger('QueueModule');

@Module({})
export class QueueModule {
  static register(): DynamicModule {
    const useMemory = process.env.USE_MEMORY_SESSION === 'true';

    if (useMemory) {
      logger.log('BullMQ queues disabled (no Redis / in-memory mode)');
      return { module: QueueModule };
    }

    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            connection: getRedisConnectionOptions(configService),
            prefix: configService.get<string>('bullmq.prefix'),
          }),
        }),
        BullModule.registerQueue(
          { name: QUEUE_NAMES.NOTIFICATIONS },
          { name: QUEUE_NAMES.INVENTORY },
          { name: QUEUE_NAMES.REPORTS },
        ),
      ],
      exports: [BullModule],
    };
  }
}
