import { PERMISSIONS } from '@/common/constants/permissions.constant';
import {
  ADMIN_MODULE_CODES,
  Phase1PermissionAction,
  PHASE1_PERMISSION_ACTIONS,
} from '@/common/constants/modules.constant';
import { CompanyAccessModuleSummary } from '@/modules/iam/authentication/interfaces/company-access-context.interface';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

const PHASE1_ACTION_SET = new Set<string>(PHASE1_PERMISSION_ACTIONS);
const ADMIN_MODULE_SET = new Set<string>(ADMIN_MODULE_CODES);

const PERMISSION_META = new Map(
  PERMISSIONS.map((row) => [row.code, { module: row.module, action: row.action }]),
);

/** Legacy ERP API permission codes → Phase 1 module + action. */
const LEGACY_PRODUCT_PERMISSION_MAP: Record<
  string,
  { moduleCode: string; action: Phase1PermissionAction }
> = {
  'customers:read': { moduleCode: 'crm', action: 'view' },
  'customers:write': { moduleCode: 'crm', action: 'edit' },
  'vendors:read': { moduleCode: 'supply-chain', action: 'view' },
  'vendors:write': { moduleCode: 'supply-chain', action: 'edit' },
  'products:read': { moduleCode: 'supply-chain', action: 'view' },
  'products:write': { moduleCode: 'supply-chain', action: 'edit' },
  'inventory:read': { moduleCode: 'supply-chain', action: 'view' },
  'inventory:write': { moduleCode: 'supply-chain', action: 'edit' },
};

export interface PermissionCheckContext {
  modules: CompanyAccessModuleSummary[];
  subscriptionStatus: string;
}

export function checkModulePermission(
  modules: CompanyAccessModuleSummary[],
  moduleCode: string,
  action: Phase1PermissionAction,
): boolean {
  const mod = modules.find((m) => m.moduleCode === moduleCode);
  if (!mod?.isActive) return false;
  return mod.permissions.includes(action);
}

/** Full Phase 1 permission chain for product modules (subscription + entitlement + role). */
export function checkPermission(
  ctx: PermissionCheckContext,
  moduleCode: string,
  action: Phase1PermissionAction,
): boolean {
  const entitled =
    ctx.subscriptionStatus === 'active' ||
    ctx.subscriptionStatus === 'trial' ||
    ctx.modules.some((m) => m.moduleCode === moduleCode);

  if (!entitled) return false;

  return checkModulePermission(ctx.modules, moduleCode, action);
}

function normalizeAction(action: string): Phase1PermissionAction | null {
  if (action === 'manage') return 'edit';
  if (PHASE1_ACTION_SET.has(action)) return action as Phase1PermissionAction;
  return null;
}

function resolveLegacyPermission(permissionCode: string) {
  return LEGACY_PRODUCT_PERMISSION_MAP[permissionCode] ?? null;
}

/** FE admin nav aliases ↔ backend permission codes. */
const PERMISSION_ALIASES: Record<string, string[]> = {
  'subscription:view': ['subscription_plans:view', 'plans:view', 'company_subscriptions:view'],
  'subscription:create': ['subscription_plans:create', 'plans:create', 'company_subscriptions:create'],
  'subscription:edit': ['subscription_plans:edit', 'plans:edit', 'company_subscriptions:edit'],
  'subscription:delete': ['subscription_plans:delete', 'plans:delete', 'company_subscriptions:delete'],
  // Catalogue read: accept FE aliases + tenant subscription view codes
  'plans:view': [
    'subscription_plans:view',
    'subscription:view',
    'company_subscriptions:view',
  ],
  'plans:create': ['subscription_plans:create', 'subscription:create'],
  'plans:edit': ['subscription_plans:edit', 'subscription:edit'],
  'plans:delete': ['subscription_plans:delete', 'subscription:delete'],
  'modules:view': [
    'subscription_modules:view',
    'company_modules:view',
    'subscription:view',
  ],
  'modules:create': ['subscription_modules:create'],
  'modules:edit': ['subscription_modules:edit'],
  'modules:delete': ['subscription_modules:delete'],
  'subscription_plans:view': ['subscription:view', 'plans:view'],
  'subscription_plans:create': ['subscription:create', 'plans:create'],
  'subscription_plans:edit': ['subscription:edit', 'plans:edit'],
  'subscription_plans:delete': ['subscription:delete', 'plans:delete'],
  'subscription_modules:view': ['modules:view', 'subscription:view', 'company_modules:view'],
  'subscription_modules:create': ['modules:create'],
  'subscription_modules:edit': ['modules:edit'],
  'subscription_modules:delete': ['modules:delete'],
  'company_subscriptions:view': ['subscription:view', 'plans:view'],
  'company_subscriptions:create': ['subscription:edit', 'subscription:create'],
  'company_subscriptions:edit': ['subscription:edit'],
  'company_subscriptions:delete': ['subscription:edit', 'subscription:delete'],
  'company_modules:view': ['modules:view', 'subscription:view'],
  'company_modules:create': ['modules:edit', 'subscription:edit'],
  'company_modules:edit': ['modules:edit', 'subscription:edit'],
  'company_modules:delete': ['modules:edit', 'subscription:edit'],
};

function userHasPermissionCode(user: AuthenticatedUser, permissionCode: string): boolean {
  if (user.permissions.includes(permissionCode)) return true;
  const aliases = PERMISSION_ALIASES[permissionCode] ?? [];
  return aliases.some((code) => user.permissions.includes(code));
}

/**
 * Unified server permission check for @RequirePermissions() codes.
 * Admin modules: flat role permission only.
 * Product modules: flat permission + subscription snapshot (modules[]).
 */
export function checkPermissionCode(
  user: AuthenticatedUser,
  permissionCode: string,
): boolean {
  if (user.role === 'super_admin') return true;

  const legacy = resolveLegacyPermission(permissionCode);
  if (legacy) {
    return checkPermission(
      {
        modules: user.modules ?? [],
        subscriptionStatus: user.subscriptionStatus ?? 'none',
      },
      legacy.moduleCode,
      legacy.action,
    );
  }

  const meta = PERMISSION_META.get(permissionCode as (typeof PERMISSIONS)[number]['code']);
  if (!meta) {
    return userHasPermissionCode(user, permissionCode);
  }

  if (!userHasPermissionCode(user, permissionCode)) return false;

  if (ADMIN_MODULE_SET.has(meta.module)) {
    return true;
  }

  const action = normalizeAction(meta.action);
  if (!action) return true;

  return checkPermission(
    {
      modules: user.modules ?? [],
      subscriptionStatus: user.subscriptionStatus ?? 'none',
    },
    meta.module,
    action,
  );
}

