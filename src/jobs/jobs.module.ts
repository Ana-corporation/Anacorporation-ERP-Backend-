import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { EntitlementsModule } from '@/modules/subscription/entitlements/entitlements.module';
import { SubscriptionExpiryScheduler } from './subscription-expiry.scheduler';
import { SubscriptionExpiryService } from './subscription-expiry.service';

@Module({
  imports: [EntitlementsModule, AuthModule],
  providers: [SubscriptionExpiryService, SubscriptionExpiryScheduler],
  exports: [SubscriptionExpiryService],
})
export class JobsModule {}
