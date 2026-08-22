import { Module } from '@nestjs/common';
import { CompaniesModule } from './companies/companies.module';
import { CompanySecurityPoliciesModule } from './company-security-policies/company-security-policies.module';
import { BranchesModule } from './branches/branches.module';
import { DepartmentsModule } from './departments/departments.module';
import { DesignationsModule } from './designations/designations.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { EmployeesModule } from './employees/employees.module';
import { CompanyAuditModule } from './company-audit/company-audit.module';

@Module({
  imports: [
    CompaniesModule,
    BranchesModule,
    DepartmentsModule,
    DesignationsModule,
    WarehousesModule,
    EmployeesModule,
    CompanySecurityPoliciesModule,
    CompanyAuditModule,
  ],
  exports: [
    CompaniesModule,
    BranchesModule,
    DepartmentsModule,
    DesignationsModule,
    WarehousesModule,
    EmployeesModule,
    CompanySecurityPoliciesModule,
    CompanyAuditModule,
  ],
})
export class OrganizationModule {}
