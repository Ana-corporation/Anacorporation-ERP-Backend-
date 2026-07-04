export interface JwtPayload {
  sub: string;
  email: string;
  sessionId: string;
  companyId?: string;
  role?: 'super_admin';
}

export interface AuthenticatedUser {
  sub: string;
  email: string;
  sessionId: string;
  companyId?: string;
  role?: 'super_admin';
  permissions: string[];
  firstName: string;
  lastName: string;
}

export interface TenantContext {
  companyId: string;
  userId: string;
}
