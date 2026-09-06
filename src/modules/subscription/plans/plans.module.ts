import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { EntitlementsModule } from '@/modules/subscription/entitlements/entitlements.module';
import { PlansController } from './plans.controller';
import { PlanModulesController } from './plan-modules.controller';
import { PlansRepository } from './plans.repository';
import { PlanModulesRepository } from './plan-modules.repository';
import { PlansService } from './plans.service';
import { PlanModulesService } from './plan-modules.service';

@Module({
  imports: [EntitlementsModule, AuthModule],
  controllers: [PlansController, PlanModulesController],
  providers: [PlansRepository, PlanModulesRepository, PlansService, PlanModulesService],
  exports: [PlansService, PlanModulesService],
})
export class PlansModule {}
