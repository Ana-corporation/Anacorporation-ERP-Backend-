import { Module } from '@nestjs/common';
import { CompaniesModule } from './companies/companies.module';
import { CompanySecurityPoliciesModule } from './company-security-policies/company-security-policies.module';
import { BranchesModule } from './branches/branches.module';
import { DepartmentsModule } from './departments/departments.module';
import { DesignationsModule } from './designations/designations.module';
import { WarehousesModule } from './warehouses/warehouses.module';

@Module({
  imports: [
    CompaniesModule,
    BranchesModule,
    DepartmentsModule,
    DesignationsModule,
    WarehousesModule,
    CompanySecurityPoliciesModule,
  ],
  exports: [
    CompaniesModule,
    BranchesModule,
    DepartmentsModule,
    DesignationsModule,
    WarehousesModule,
    CompanySecurityPoliciesModule,
  ],
})
export class OrganizationModule {}
