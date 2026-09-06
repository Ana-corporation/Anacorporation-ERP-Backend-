import { CompanyAccessContext } from '../interfaces/company-access-context.interface';

/** Client snapshot returned by login / GET /auth/me after role shaping. */
export interface AuthRoleSnapshot extends CompanyAccessContext {
  /** FE/QA authorization contract — tenant codes for company roles; platform nav for OWNER. */
  permissions: string[];
  /** Lightweight module codes with effective product access (backend-resolved). */
  entitlements?: { modules: string[] };
  /** True when active role is company ADMIN (tenant admin). */
  tenantAdmin: boolean;
  /** True when active role is PLATFORM_OWNER. */
  platformOwner: boolean;
  /** True when invited user must set a permanent password. */
  mustChangePassword: boolean;
}

export interface RoleLoginHandlerInput {
  accessContext: CompanyAccessContext;
  /** Raw RolePermission codes from DB (source for permissions[] after role filter). */
  rolePermissions: string[];
}

export type RoleLoginHandler = (input: RoleLoginHandlerInput) => AuthRoleSnapshot;

/** Role codes used by client login samples / FE nav rules. */
export const AUTH_ROLE_CODES = {
  PLATFORM_OWNER: 'PLATFORM_OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF',
  SALES: 'SALES',
  VIEWER: 'VIEWER',
} as const;

export type AuthRoleCode = (typeof AUTH_ROLE_CODES)[keyof typeof AUTH_ROLE_CODES];

/**
 * Platform Administration nav codes expected by the frontend.
 * Only PLATFORM_OWNER should expose these in login / /auth/me → permissions[].
 * Company roles must NEVER receive these in the visible contract.
 */
export const PLATFORM_NAV_PERMISSIONS = [
  'companies:view',
  'companies:create',
  'companies:edit',
  'companies:delete',
  'platform_companies:view',
  'platform_companies:edit',
  'user_audit:view',
  'subscription:view',
  'subscription:edit',
  'modules:view',
  'modules:edit',
  'plans:view',
  'plans:edit',
] as const;
