import { Phase1PermissionAction } from '@/common/constants/modules.constant';

export interface CompanyAccessUserSummary {
  userId: string;
  username: string;
  displayName: string;
  email: string;
}

export interface CompanyAccessCompanySummary {
  companyId: string;
  companyCode: string;
  name: string;
  isDefault: boolean;
  status: string;
}

export interface CompanyAccessRoleSummary {
  roleId: string;
  roleCode: string;
  roleName: string;
}

export interface CompanyAccessSubscriptionSummary {
  status: string;
  planCode: string | null;
  planName: string | null;
  endDate: string | null;
  isCustom: boolean;
}

export interface CompanyAccessModuleSummary {
  moduleId: number;
  moduleCode: string;
  moduleName: string;
  isActive: boolean;
  permissions: Phase1PermissionAction[];
}

export interface CompanyAccessContext {
  user: CompanyAccessUserSummary;
  companies: CompanyAccessCompanySummary[];
  activeCompany: {
    companyId: string;
    companyCode: string;
    name: string;
    status: string;
    role: CompanyAccessRoleSummary | null;
    subscription: CompanyAccessSubscriptionSummary;
    modules: CompanyAccessModuleSummary[];
  };
}
