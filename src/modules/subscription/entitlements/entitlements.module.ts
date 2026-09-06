import { Module } from '@nestjs/common';
import { CompanyModuleOverridesService } from './company-module-overrides.service';
import { EntitlementRepository } from './entitlement.repository';
import { EntitlementService } from './entitlement.service';
import { EntitlementsController } from './entitlements.controller';

@Module({
  controllers: [EntitlementsController],
  providers: [
    EntitlementRepository,
    EntitlementService,
    CompanyModuleOverridesService,
  ],
  exports: [EntitlementService, EntitlementRepository, CompanyModuleOverridesService],
})
export class EntitlementsModule {}
