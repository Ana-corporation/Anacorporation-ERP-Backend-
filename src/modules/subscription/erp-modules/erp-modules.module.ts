import { Module } from '@nestjs/common';
import { ErpModulesController } from './erp-modules.controller';
import { ErpModulesRepository } from './erp-modules.repository';
import { ErpModulesService } from './erp-modules.service';

@Module({
  controllers: [ErpModulesController],
  providers: [ErpModulesRepository, ErpModulesService],
  exports: [ErpModulesService],
})
export class ErpModulesModule {}
