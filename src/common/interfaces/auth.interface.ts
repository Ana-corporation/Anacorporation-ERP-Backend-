import { CompanyAccessModuleSummary } from '@/modules/iam/authentication/interfaces/company-access-context.interface';

export interface JwtPayload {
  sub: string;
  email: string;
  cid?: string;
  sid?: string;
  role?: string;
  companyId?: string;
  sessionId?: string;
}

export interface AuthenticatedUser {
  sub: string;
  email: string;
  sessionId: string;
  companyId?: string;
  role?: string;
  permissions: string[];
  modules: CompanyAccessModuleSummary[];
  subscriptionStatus: string;
  firstName: string;
  lastName: string;
  /** True when user_authentication.must_change_password is set (invite temp password). */
  mustChangePassword?: boolean;
}

export interface TenantContext {
  companyId: string;
  userId: string;
}
