import { CompanyAccessContext } from '../interfaces/company-access-context.interface';

/** Client snapshot returned by login / GET /auth/me after role shaping. */
export interface AuthRoleSnapshot extends CompanyAccessContext {
  permissions: string[];
}

export interface RoleLoginHandlerInput {
  accessContext: CompanyAccessContext;
  /** Raw RolePermission codes from DB (used by platform owner; ignored for company roles on FE). */
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
 * Only PLATFORM_OWNER should expose these in /auth/me → permissions[].
 */
export const PLATFORM_NAV_PERMISSIONS = [
  'companies:view',
  'companies:create',
  'companies:edit',
  'companies:delete',
  'subscription:view',
  'subscription:edit',
  'modules:view',
  'modules:edit',
  'plans:view',
  'plans:edit',
] as const;
