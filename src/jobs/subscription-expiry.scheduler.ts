import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionExpiryService } from './subscription-expiry.service';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionExpiryScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly expiryService: SubscriptionExpiryService,
  ) {}

  onModuleInit() {
    const enabled =
      this.configService.get<string>('SUBSCRIPTION_EXPIRY_JOB_ENABLED') === 'true';
    if (!enabled) {
      this.logger.log('Subscription expiry scheduler disabled (SUBSCRIPTION_EXPIRY_JOB_ENABLED != true)');
      return;
    }

    const intervalMs = Number(
      this.configService.get<string>('SUBSCRIPTION_EXPIRY_JOB_INTERVAL_MS') ??
        DEFAULT_INTERVAL_MS,
    );

    this.logger.log(`Subscription expiry scheduler enabled (every ${intervalMs}ms)`);
    void this.runOnce();

    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runOnce() {
    try {
      const result = await this.expiryService.run();
      if (result.processed > 0) {
        this.logger.log(`Expired ${result.processed} subscription(s)`);
      }
    } catch (err) {
      this.logger.error('Subscription expiry job failed', err instanceof Error ? err.stack : err);
    }
  }
}
