import { Module } from '@nestjs/common';
import { RolesModule } from '@/modules/iam/roles/roles.module';
import { CompanyModulesController } from './company-modules.controller';
import { CompanyModulesRepository } from './company-modules.repository';
import { CompanyModulesService } from './company-modules.service';

@Module({
  imports: [RolesModule],
  controllers: [CompanyModulesController],
  providers: [CompanyModulesRepository, CompanyModulesService],
  exports: [CompanyModulesService, CompanyModulesRepository],
})
export class CompanyModulesModule {}
