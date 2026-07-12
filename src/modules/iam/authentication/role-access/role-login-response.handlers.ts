import {
  AUTH_ROLE_CODES,
  AuthRoleSnapshot,
  PLATFORM_NAV_PERMISSIONS,
  RoleLoginHandler,
  RoleLoginHandlerInput,
} from './role-login-response.types';

const PLATFORM_NAV_SET = new Set<string>(PLATFORM_NAV_PERMISSIONS);

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
  };
}

/** Keep only the active company in the companies list (tenant isolation for FE). */
function scopeToActiveCompany(snapshot: AuthRoleSnapshot): AuthRoleSnapshot {
  const activeId = snapshot.activeCompany.companyId;
  snapshot.companies = snapshot.companies.filter((c) => c.companyId === activeId);
  return snapshot;
}

/** Drop modules that have no "view" — FE hides them anyway; keeps payload clean. */
function keepViewableModules(snapshot: AuthRoleSnapshot): AuthRoleSnapshot {
  snapshot.activeCompany.modules = snapshot.activeCompany.modules.filter((m) =>
    m.isActive && m.permissions.includes('view'),
  );
  return snapshot;
}

/**
 * PLATFORM_OWNER — platform catalogue nav only; no workspace product modules.
 * FE shows Administration (Companies / Plans / Modules).
 */
export const handlePlatformOwner: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.activeCompany.modules = [];
  snapshot.permissions = input.rolePermissions.filter((code) => PLATFORM_NAV_SET.has(code));
  return scopeToActiveCompany(snapshot);
};

/**
 * ADMIN — full control of one company only.
 * All subscribed modules with full actions; permissions[] empty → no platform menu.
 */
export const handleCompanyAdmin: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = [];
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * MANAGER — assigned modules with partial actions (no platform menu).
 */
export const handleManager: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = [];
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * STAFF — view-only on assigned modules.
 */
export const handleStaff: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = [];
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * SALES — CRM (or assigned) with create/edit; no platform menu.
 */
export const handleSales: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = [];
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * VIEWER — view-only on assigned modules.
 */
export const handleViewer: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = [];
  return scopeToActiveCompany(keepViewableModules(snapshot));
};

/**
 * Fallback for unknown company roles — company-scoped, no platform nav.
 */
export const handleDefaultCompanyRole: RoleLoginHandler = (input) => {
  const snapshot = cloneContext(input);
  snapshot.permissions = [];
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
