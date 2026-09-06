import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { EntitlementsModule } from '@/modules/subscription/entitlements/entitlements.module';
import { RolesModule } from '@/modules/iam/roles/roles.module';
import { CompanyModulesController } from './company-modules.controller';
import { CompanyModulesRepository } from './company-modules.repository';
import { CompanyModulesService } from './company-modules.service';

@Module({
  imports: [RolesModule, EntitlementsModule, AuthModule],
  controllers: [CompanyModulesController],
  providers: [CompanyModulesRepository, CompanyModulesService],
  exports: [CompanyModulesService, CompanyModulesRepository],
})
export class CompanyModulesModule {}
