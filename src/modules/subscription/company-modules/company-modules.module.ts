import { Module } from '@nestjs/common';
import { CompanyModulesController } from './company-modules.controller';
import { CompanyModulesRepository } from './company-modules.repository';
import { CompanyModulesService } from './company-modules.service';

@Module({
  controllers: [CompanyModulesController],
  providers: [CompanyModulesRepository, CompanyModulesService],
  exports: [CompanyModulesService, CompanyModulesRepository],
})
export class CompanyModulesModule {}
