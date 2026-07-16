import { Module } from '@nestjs/common';
import { CompanySubscriptionsController } from './company-subscriptions.controller';
import { CompanySubscriptionCurrentController } from './company-subscription-current.controller';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository';
import { CompanySubscriptionsService } from './company-subscriptions.service';

@Module({
  controllers: [CompanySubscriptionsController, CompanySubscriptionCurrentController],
  providers: [CompanySubscriptionsRepository, CompanySubscriptionsService],
  exports: [CompanySubscriptionsService, CompanySubscriptionsRepository],
})
export class CompanySubscriptionsModule {}
