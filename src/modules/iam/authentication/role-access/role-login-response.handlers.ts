import {
  AUTH_ROLE_CODES,
  AuthRoleSnapshot,
  PLATFORM_NAV_PERMISSIONS,
  RoleLoginHandler,
  RoleLoginHandlerInput,
} from './role-login-response.types';

const PLATFORM_NAV_SET = new Set<string>(PLATFORM_NAV_PERMISSIONS);

/**
 * Tenant authorization contract: all role permission codes except platform-nav.
 * Used by Company ADMIN (and other company roles) for FE / QA visibility.
 * Backend API guards still load full DB permissions separately.
 */
export function toTenantPermissions(rolePermissions: string[]): string[] {
  return [...new Set(rolePermissions.filter((code) => !PLATFORM_NAV_SET.has(code)))].sort();
}

function cloneContext(input: RoleLoginHandlerInput): AuthRoleSnapshot {
  const { accessContext } = input;
  return {
    user: { ...accessContext.user },
    companies: accessContext.companies.map((c) => ({ ...c })),
    activeCompany: {
      ...accessContext.activeCompany,
      role: accessContext.activeCompany.role
        ? { ...accessContext.activeCompany.role }
        : null,
      subscription: { ...accessContext.activeCompany.subscription },
      modules: accessContext.activeCompany.modules.map((m) => ({
        ...m,
        permissions: [...m.permissions],
      })),
    },
    permissions: [],
    tenantAdmin: false,
    platformOwner: false,
    mustChangePassword: false,
  };
}

/** Keep only the active company in the companies list (tenant isolation for FE). */
function scopeToActiveCompany(snapshot: AuthRoleSnapshot): AuthRoleSnapshot {
  const activeId = snapshot.activeCompany.companyId;
  snapshot.companies = snapshot.companies.filter((c) => c.companyId === activeId);
  return snapshot;
}

function attachEntitlements(snapshot: AuthRoleSnapshot): AuthRoleSnapshot {
  snapshot.entitlements = {
    modules: snapshot.activeCompany.modules
      .filter((m) => m.effectiveAccess ?? m.isActive)
      .map((m) => m.moduleCode),
  };
  return snapshot;
}

/** Drop modules that have no "view" — FE hides them anyway; keeps payload clean. */
function keepViewableModules(snapshot: AuthRoleSnapshot): AuthRoleSnapshot {
  snapshot.activeCompany.modules = snapshot.activeCompany.modules.filter(
    (m) => (m.effectiveAccess ?? m.isActive) && m.permissions.includes('view'),
  );
  return attachEntitlements(snapshot);
}

/**
 * PLATFORM_OWNER — platform catalogue nav only; no workspace product modules.
 * FE shows Administration (Companies / Plans / Modules).
 */
export const handlePlatformOwner: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.activeCompany.modules = [];
  // Always expose full platform nav contract (legacy + platform_companies + audit).
  snapshot.permissions = [
    ...new Set([
      ...PLATFORM_NAV_PERMISSIONS,
      ...input.rolePermissions.filter((code) => PLATFORM_NAV_SET.has(code)),
    ]),
  ];
  snapshot.tenantAdmin = false;
  snapshot.platformOwner = true;
  return scopeToActiveCompany(snapshot);
};

/**
 * ADMIN — full control of one company (Option C Hybrid).
 * permissions[] = tenant role codes (org / iam / shared / product…), never platform nav.
 */
export const handleCompanyAdmin: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = toTenantPermissions(input.rolePermissions);
  snapshot.tenantAdmin = true;
  snapshot.platformOwner = false;
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * MANAGER — assigned modules with partial actions; expose tenant role perms.
 */
export const handleManager: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = toTenantPermissions(input.rolePermissions);
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * STAFF — view-only on assigned modules.
 */
export const handleStaff: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = toTenantPermissions(input.rolePermissions);
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * SALES — CRM (or assigned) with create/edit; no platform menu.
 */
export const handleSales: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = toTenantPermissions(input.rolePermissions);
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * VIEWER — view-only on assigned modules.
 */
export const handleViewer: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = toTenantPermissions(input.rolePermissions);
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * Fallback for unknown company roles — company-scoped, tenant permissions only.
 */
export const handleDefaultCompanyRole: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = toTenantPermissions(input.rolePermissions);
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

export const ROLE_LOGIN_HANDLERS: Record<string, RoleLoginHandler> = {
  [AUTH_ROLE_CODES.PLATFORM_OWNER]: handlePlatformOwner,
  [AUTH_ROLE_CODES.ADMIN]: handleCompanyAdmin,
  [AUTH_ROLE_CODES.MANAGER]: handleManager,
  [AUTH_ROLE_CODES.STAFF]: handleStaff,
  [AUTH_ROLE_CODES.SALES]: handleSales,
  [AUTH_ROLE_CODES.VIEWER]: handleViewer,
};
