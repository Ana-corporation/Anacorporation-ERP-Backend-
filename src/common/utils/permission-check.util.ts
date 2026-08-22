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

/**
 * Platform-owner seed / nav still uses short aliases (plans:view).
 * Controllers require catalogue codes (subscription_plans:view).
 */
const PERMISSION_CODE_ALIASES: Record<string, string[]> = {
  'subscription_plans:view': ['plans:view'],
  'subscription_plans:create': ['plans:edit', 'plans:create'],
  'subscription_plans:edit': ['plans:edit'],
  'subscription_plans:delete': ['plans:edit', 'plans:delete'],
  'subscription_modules:view': ['modules:view'],
  'subscription_modules:create': ['modules:edit', 'modules:create'],
  'subscription_modules:edit': ['modules:edit'],
  'subscription_modules:delete': ['modules:edit', 'modules:delete'],
  'plan_modules:view': ['plans:view'],
  'plan_modules:manage': ['plans:edit'],
  // Platform Owner company-detail tabs reuse tenant APIs
  'companies:view': ['platform_companies:view'],
  'companies:create': ['platform_companies:edit', 'companies:create'],
  'companies:edit': ['platform_companies:edit', 'companies:edit'],
  'companies:delete': ['platform_companies:edit', 'companies:delete'],
  'company_subscriptions:view': [
    'platform_companies:view',
    'companies:view',
    'subscription:view',
  ],
  'company_subscriptions:create': [
    'platform_companies:edit',
    'companies:edit',
    'subscription:edit',
  ],
  'company_subscriptions:edit': [
    'platform_companies:edit',
    'companies:edit',
    'subscription:edit',
  ],
  'company_subscriptions:delete': [
    'platform_companies:edit',
    'companies:edit',
    'subscription:edit',
  ],
  'company_modules:view': ['platform_companies:view', 'companies:view', 'modules:view'],
  'company_modules:create': ['platform_companies:edit', 'companies:edit', 'modules:edit'],
  'company_modules:edit': ['platform_companies:edit', 'companies:edit', 'modules:edit'],
  'company_modules:delete': ['platform_companies:edit', 'companies:edit', 'modules:edit'],
  'users:view': ['platform_companies:view', 'companies:view'],
  'users:create': ['platform_companies:edit', 'companies:edit'],
  'users:edit': ['platform_companies:edit', 'companies:edit'],
  'users:delete': ['platform_companies:edit', 'companies:edit'],
  'roles:view': ['platform_companies:view', 'companies:view'],
  'user_audit:view': ['platform_companies:view', 'companies:view', 'user_audit:view'],
  // Legacy module-level supply-chain:* still satisfies resource checks until roles migrate
  ...Object.fromEntries(
    PHASE1_PERMISSION_ACTIONS.flatMap((action) => [
      [`vendors:${action}`, [`supply-chain:${action}`]],
      [`items:${action}`, [`supply-chain:${action}`]],
    ]),
  ),
};

function userHasPermissionCode(user: AuthenticatedUser, permissionCode: string): boolean {
  if (user.permissions.includes(permissionCode)) return true;
  const aliases = PERMISSION_CODE_ALIASES[permissionCode];
  return Boolean(aliases?.some((alias) => user.permissions.includes(alias)));
}

/** Legacy ERP API codes → resource-level catalogue codes (Supply Chain split). */
const LEGACY_TO_RESOURCE_CODE: Record<string, string> = {
  'vendors:read': 'vendors:view',
  'vendors:write': 'vendors:edit',
  'products:read': 'items:view',
  'products:write': 'items:edit',
  'inventory:read': 'items:view',
  'inventory:write': 'items:edit',
};

/** Legacy ERP API permission codes → Phase 1 module + action (non–Supply Chain). */
const LEGACY_PRODUCT_PERMISSION_MAP: Record<
  string,
  { moduleCode: string; action: Phase1PermissionAction }
> = {
  'customers:read': { moduleCode: 'crm', action: 'view' },
  'customers:write': { moduleCode: 'crm', action: 'edit' },
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
  // isActive already means ACTIVE company entitlement + AVAILABLE lifecycle (login snapshot)
  if (!mod?.isActive) return false;
  return mod.permissions.includes(action);
}

/** Full Phase 1 permission chain for product modules (entitlement snapshot + role). */
export function checkPermission(
  ctx: PermissionCheckContext,
  moduleCode: string,
  action: Phase1PermissionAction,
): boolean {
  // Entitlement is proven by presence of an ACTIVE module in the login snapshot.
  // Do not allow subscriptionStatus alone to bypass missing company_modules.
  if (!ctx.modules.some((m) => m.moduleCode === moduleCode && m.isActive)) {
    return false;
  }

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

  const resourceMapped = LEGACY_TO_RESOURCE_CODE[permissionCode];
  if (resourceMapped) {
    return checkPermissionCode(user, resourceMapped);
  }

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
