import { Phase1PermissionAction } from '@/common/constants/modules.constant';

export interface CompanyAccessUserSummary {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  employeeCode: string | null;
}

export interface CompanyAccessMembershipSummary {
  departmentId: string | null;
  departmentName: string | null;
  designationId: string | null;
  designationName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  status: 'ACTIVE' | 'INACTIVE';
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
  systemTemplateKey?: string | null;
  roleType?: string | null;
  isSystem?: boolean;
}

export interface CompanyAccessSubscriptionSummary {
  status: string;
  planCode: string | null;
  planName: string | null;
  startDate: string | null;
  endDate: string | null;
  isCustom: boolean;
  autoRenew?: boolean;
  cancelAtPeriodEnd?: boolean;
  isValid?: boolean;
}

export interface CompanyAccessModuleSummary {
  moduleId: number;
  moduleCode: string;
  moduleName: string;
  /** @deprecated Use effectiveAccess — kept for backward compatibility */
  isActive: boolean;
  entitled: boolean;
  enabled: boolean;
  effectiveAccess: boolean;
  lifecycleStatus?: string | null;
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
    membership: CompanyAccessMembershipSummary | null;
    subscription: CompanyAccessSubscriptionSummary;
    modules: CompanyAccessModuleSummary[];
  };
}
