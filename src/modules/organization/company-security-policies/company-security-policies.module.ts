import { Module } from '@nestjs/common';
import { CompanySecurityPoliciesController } from './company-security-policies.controller';
import { CompanySecurityPoliciesRepository } from './company-security-policies.repository';
import { CompanySecurityPoliciesService } from './company-security-policies.service';

@Module({
  controllers: [CompanySecurityPoliciesController],
  providers: [CompanySecurityPoliciesRepository, CompanySecurityPoliciesService],
  exports: [CompanySecurityPoliciesService, CompanySecurityPoliciesRepository],
})
export class CompanySecurityPoliciesModule {}
