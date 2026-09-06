import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { EntitlementsModule } from '@/modules/subscription/entitlements/entitlements.module';
import { CompanySubscriptionCurrentController } from './company-subscription-current.controller';
import { CompanySubscriptionsController } from './company-subscriptions.controller';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository';
import { CompanySubscriptionsService } from './company-subscriptions.service';

@Module({
  imports: [EntitlementsModule, AuthModule],
  controllers: [CompanySubscriptionsController, CompanySubscriptionCurrentController],
  providers: [CompanySubscriptionsRepository, CompanySubscriptionsService],
  exports: [CompanySubscriptionsService, CompanySubscriptionsRepository],
})
export class CompanySubscriptionsModule {}
