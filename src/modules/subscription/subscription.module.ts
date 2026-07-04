import { Module } from '@nestjs/common';
import { CompanyModulesModule } from './company-modules/company-modules.module';
import { CompanySubscriptionsModule } from './company-subscriptions/company-subscriptions.module';
import { PlansModule } from './plans/plans.module';
import { ErpModulesModule } from './erp-modules/erp-modules.module';

@Module({
  imports: [PlansModule, ErpModulesModule, CompanySubscriptionsModule, CompanyModulesModule],
  exports: [PlansModule, ErpModulesModule, CompanySubscriptionsModule, CompanyModulesModule],
})
export class SubscriptionModule {}
