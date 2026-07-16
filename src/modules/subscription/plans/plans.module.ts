import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansAliasController } from './plans-alias.controller';
import { PlanModulesController } from './plan-modules.controller';
import { PlansRepository } from './plans.repository';
import { PlanModulesRepository } from './plan-modules.repository';
import { PlansService } from './plans.service';
import { PlanModulesService } from './plan-modules.service';

@Module({
  controllers: [PlansController, PlansAliasController, PlanModulesController],
  providers: [PlansRepository, PlanModulesRepository, PlansService, PlanModulesService],
  exports: [PlansService, PlanModulesService],
})
export class PlansModule {}
