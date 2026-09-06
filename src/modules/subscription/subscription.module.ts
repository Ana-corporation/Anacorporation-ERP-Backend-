import { Module } from '@nestjs/common';
import { CompanyModulesModule } from './company-modules/company-modules.module';
import { CompanySubscriptionsModule } from './company-subscriptions/company-subscriptions.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { PlansModule } from './plans/plans.module';
import { ErpModulesModule } from './erp-modules/erp-modules.module';

@Module({
  imports: [
    PlansModule,
    ErpModulesModule,
    EntitlementsModule,
    CompanySubscriptionsModule,
    CompanyModulesModule,
  ],
  exports: [
    PlansModule,
    ErpModulesModule,
    EntitlementsModule,
    CompanySubscriptionsModule,
    CompanyModulesModule,
  ],
})
export class SubscriptionModule {}
