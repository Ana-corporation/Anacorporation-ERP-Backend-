import { Module } from '@nestjs/common';
import { ErpModulesController } from './erp-modules.controller';
import { ModulesAliasController } from './modules-alias.controller';
import { ErpModulesRepository } from './erp-modules.repository';
import { ErpModulesService } from './erp-modules.service';

@Module({
  controllers: [ErpModulesController, ModulesAliasController],
  providers: [ErpModulesRepository, ErpModulesService],
  exports: [ErpModulesService],
})
export class ErpModulesModule {}
