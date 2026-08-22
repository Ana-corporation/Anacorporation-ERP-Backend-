import { PHASE1_PERMISSION_ACTIONS, PRODUCT_MODULES } from './modules.constant';

/** Module-level Phase-1 codes (legacy for product modules; kept for entitlement + migration). */
const PRODUCT_PERMISSIONS = PRODUCT_MODULES.flatMap((mod) =>
  PHASE1_PERMISSION_ACTIONS.map((action) => ({
    module: mod.code,
    code: `${mod.code}:${action}`,
    name: `${mod.name} — ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
    action,
    resource: null as string | null,
    resourceDisplayName: null as string | null,
  })),
);

/**
 * Supply Chain resource-level permissions (MODULE → RESOURCE → ACTION).
 * Codes follow existing `resource:action` convention (same as users:view).
 * Module remains `supply-chain` for company entitlement / lifecycle.
 */
export const SUPPLY_CHAIN_RESOURCES = [
  { resource: 'vendors', displayName: 'Vendors' },
  { resource: 'items', displayName: 'Items' },
] as const;

export type SupplyChainResource = (typeof SUPPLY_CHAIN_RESOURCES)[number]['resource'];

export const SUPPLY_CHAIN_RESOURCE_PERMISSIONS = SUPPLY_CHAIN_RESOURCES.flatMap((r) =>
  PHASE1_PERMISSION_ACTIONS.map((action) => ({
    module: 'supply-chain' as const,
    code: `${r.resource}:${action}`,
    name: `${r.displayName} — ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
    action,
    resource: r.resource,
    resourceDisplayName: r.displayName,
  })),
);

/** Expand legacy `supply-chain:{action}` → vendors + items resource codes. */
export function expandSupplyChainModulePermission(code: string): string[] {
  const match = /^supply-chain:(view|create|edit|delete|approve)$/.exec(code);
  if (!match) return [code];
  const action = match[1];
  return [`vendors:${action}`, `items:${action}`];
}

const ADMIN_PERMISSIONS = [
  { module: 'organization', code: 'companies:view', name: 'View Companies', action: 'view' },
  { module: 'organization', code: 'companies:create', name: 'Create Companies', action: 'create' },
  { module: 'organization', code: 'companies:edit', name: 'Edit Companies', action: 'edit' },
  { module: 'organization', code: 'companies:delete', name: 'Delete Companies', action: 'delete' },
  { module: 'organization', code: 'departments:view', name: 'View Departments', action: 'view' },
  { module: 'organization', code: 'departments:create', name: 'Create Departments', action: 'create' },
  { module: 'organization', code: 'departments:edit', name: 'Edit Departments', action: 'edit' },
  { module: 'organization', code: 'departments:delete', name: 'Delete Departments', action: 'delete' },
  { module: 'organization', code: 'designations:view', name: 'View Designations', action: 'view' },
  { module: 'organization', code: 'designations:create', name: 'Create Designations', action: 'create' },
  { module: 'organization', code: 'designations:edit', name: 'Edit Designations', action: 'edit' },
  { module: 'organization', code: 'designations:delete', name: 'Delete Designations', action: 'delete' },
  { module: 'organization', code: 'branches:view', name: 'View Branches', action: 'view' },
  { module: 'organization', code: 'branches:create', name: 'Create Branches', action: 'create' },
  { module: 'organization', code: 'branches:edit', name: 'Edit Branches', action: 'edit' },
  { module: 'organization', code: 'branches:delete', name: 'Delete Branches', action: 'delete' },
  { module: 'organization', code: 'warehouses:view', name: 'View Warehouses', action: 'view' },
  { module: 'organization', code: 'warehouses:create', name: 'Create Warehouses', action: 'create' },
  { module: 'organization', code: 'warehouses:edit', name: 'Edit Warehouses', action: 'edit' },
  { module: 'organization', code: 'warehouses:delete', name: 'Delete Warehouses', action: 'delete' },
  { module: 'organization', code: 'company_security_policies:view', name: 'View Company Security Policies', action: 'view' },
  { module: 'organization', code: 'company_security_policies:create', name: 'Create Company Security Policies', action: 'create' },
  { module: 'organization', code: 'company_security_policies:edit', name: 'Edit Company Security Policies', action: 'edit' },
  { module: 'organization', code: 'company_security_policies:delete', name: 'Delete Company Security Policies', action: 'delete' },
  { module: 'iam', code: 'users:view', name: 'View Users', action: 'view' },
  { module: 'iam', code: 'users:create', name: 'Create Users', action: 'create' },
  { module: 'iam', code: 'users:edit', name: 'Edit Users', action: 'edit' },
  { module: 'iam', code: 'users:delete', name: 'Delete Users', action: 'delete' },
  { module: 'iam', code: 'roles:view', name: 'View Roles', action: 'view' },
  { module: 'iam', code: 'roles:create', name: 'Create Roles', action: 'create' },
  { module: 'iam', code: 'roles:edit', name: 'Edit Roles', action: 'edit' },
  { module: 'iam', code: 'roles:delete', name: 'Delete Roles', action: 'delete' },
  { module: 'iam', code: 'permission_sets:view', name: 'View Permission Sets', action: 'view' },
  { module: 'iam', code: 'permission_sets:create', name: 'Create Permission Sets', action: 'create' },
  { module: 'iam', code: 'permission_sets:edit', name: 'Edit Permission Sets', action: 'edit' },
  { module: 'iam', code: 'permission_sets:delete', name: 'Delete Permission Sets', action: 'delete' },
  { module: 'iam', code: 'data_access_policies:view', name: 'View Data Access Policies', action: 'view' },
  { module: 'iam', code: 'data_access_policies:create', name: 'Create Data Access Policies', action: 'create' },
  { module: 'iam', code: 'data_access_policies:edit', name: 'Edit Data Access Policies', action: 'edit' },
  { module: 'iam', code: 'data_access_policies:delete', name: 'Delete Data Access Policies', action: 'delete' },
  { module: 'iam', code: 'permissions:view', name: 'View Permissions', action: 'view' },
  { module: 'iam', code: 'api_keys:view', name: 'View API Keys', action: 'view' },
  { module: 'iam', code: 'api_keys:create', name: 'Create API Keys', action: 'create' },
  { module: 'iam', code: 'api_keys:edit', name: 'Edit API Keys', action: 'edit' },
  { module: 'iam', code: 'api_keys:delete', name: 'Revoke API Keys', action: 'delete' },
  { module: 'iam', code: 'user_attachments:view', name: 'View User Attachments', action: 'view' },
  { module: 'iam', code: 'user_attachments:create', name: 'Create User Attachments', action: 'create' },
  { module: 'iam', code: 'user_attachments:edit', name: 'Edit User Attachments', action: 'edit' },
  { module: 'iam', code: 'user_attachments:delete', name: 'Delete User Attachments', action: 'delete' },
  { module: 'iam', code: 'user_consents:view', name: 'View User Consents', action: 'view' },
  { module: 'iam', code: 'user_consents:create', name: 'Create User Consents', action: 'create' },
  { module: 'iam', code: 'user_consents:edit', name: 'Edit User Consents', action: 'edit' },
  { module: 'iam', code: 'user_consents:delete', name: 'Delete User Consents', action: 'delete' },
  { module: 'iam', code: 'user_delegations:view', name: 'View User Delegations', action: 'view' },
  { module: 'iam', code: 'user_delegations:create', name: 'Create User Delegations', action: 'create' },
  { module: 'iam', code: 'user_delegations:edit', name: 'Edit User Delegations', action: 'edit' },
  { module: 'iam', code: 'user_delegations:delete', name: 'Delete User Delegations', action: 'delete' },
  { module: 'iam', code: 'user_devices:view', name: 'View User Devices', action: 'view' },
  { module: 'iam', code: 'user_devices:create', name: 'Create User Devices', action: 'create' },
  { module: 'iam', code: 'user_devices:edit', name: 'Edit User Devices', action: 'edit' },
  { module: 'iam', code: 'user_devices:delete', name: 'Delete User Devices', action: 'delete' },
  { module: 'iam', code: 'user_mfa:view', name: 'View User MFA', action: 'view' },
  { module: 'iam', code: 'user_mfa:create', name: 'Create User MFA', action: 'create' },
  { module: 'iam', code: 'user_mfa:edit', name: 'Edit User MFA', action: 'edit' },
  { module: 'iam', code: 'user_mfa:delete', name: 'Delete User MFA', action: 'delete' },
  { module: 'iam', code: 'user_module_access:view', name: 'View User Module Access', action: 'view' },
  { module: 'iam', code: 'user_module_access:create', name: 'Create User Module Access', action: 'create' },
  { module: 'iam', code: 'user_module_access:edit', name: 'Edit User Module Access', action: 'edit' },
  { module: 'iam', code: 'user_module_access:delete', name: 'Delete User Module Access', action: 'delete' },
  { module: 'iam', code: 'user_preferences:view', name: 'View User Preferences', action: 'view' },
  { module: 'iam', code: 'user_preferences:create', name: 'Create User Preferences', action: 'create' },
  { module: 'iam', code: 'user_preferences:edit', name: 'Edit User Preferences', action: 'edit' },
  { module: 'iam', code: 'user_preferences:delete', name: 'Delete User Preferences', action: 'delete' },
  { module: 'iam', code: 'user_sessions:view', name: 'View User Sessions', action: 'view' },
  { module: 'iam', code: 'user_sessions:create', name: 'Create User Sessions', action: 'create' },
  { module: 'iam', code: 'user_sessions:edit', name: 'Edit User Sessions', action: 'edit' },
  { module: 'iam', code: 'user_sessions:delete', name: 'Delete User Sessions', action: 'delete' },
  { module: 'iam', code: 'user_login_history:view', name: 'View User Login History', action: 'view' },
  { module: 'iam', code: 'user_login_history:create', name: 'Create User Login History', action: 'create' },
  { module: 'iam', code: 'user_login_history:delete', name: 'Delete User Login History', action: 'delete' },
  { module: 'iam', code: 'user_notifications:view', name: 'View User Notifications', action: 'view' },
  { module: 'iam', code: 'user_notifications:create', name: 'Create User Notifications', action: 'create' },
  { module: 'iam', code: 'user_notifications:edit', name: 'Edit User Notifications', action: 'edit' },
  { module: 'iam', code: 'user_notifications:delete', name: 'Delete User Notifications', action: 'delete' },
  { module: 'iam', code: 'user_signatures:view', name: 'View User Signatures', action: 'view' },
  { module: 'iam', code: 'user_signatures:create', name: 'Create User Signatures', action: 'create' },
  { module: 'iam', code: 'user_signatures:edit', name: 'Edit User Signatures', action: 'edit' },
  { module: 'iam', code: 'user_signatures:delete', name: 'Delete User Signatures', action: 'delete' },
  { module: 'iam', code: 'user_audit:view', name: 'View User Audit Logs', action: 'view' },
  { module: 'shared', code: 'currencies:view', name: 'View Currencies', action: 'view' },
  { module: 'shared', code: 'currencies:manage', name: 'Manage Currencies', action: 'manage' },
  { module: 'shared', code: 'custom_fields:view', name: 'View Custom Fields', action: 'view' },
  { module: 'shared', code: 'custom_fields:create', name: 'Create Custom Fields', action: 'create' },
  { module: 'shared', code: 'custom_fields:edit', name: 'Edit Custom Fields', action: 'edit' },
  { module: 'shared', code: 'custom_fields:delete', name: 'Delete Custom Fields', action: 'delete' },
  { module: 'subscription', code: 'subscription_plans:view', name: 'View Subscription Plans', action: 'view' },
  { module: 'subscription', code: 'subscription_plans:create', name: 'Create Subscription Plans', action: 'create' },
  { module: 'subscription', code: 'subscription_plans:edit', name: 'Edit Subscription Plans', action: 'edit' },
  { module: 'subscription', code: 'subscription_plans:delete', name: 'Delete Subscription Plans', action: 'delete' },
  { module: 'subscription', code: 'subscription_modules:view', name: 'View ERP Modules', action: 'view' },
  { module: 'subscription', code: 'subscription_modules:create', name: 'Create ERP Modules', action: 'create' },
  { module: 'subscription', code: 'subscription_modules:edit', name: 'Edit ERP Modules', action: 'edit' },
  { module: 'subscription', code: 'subscription_modules:delete', name: 'Delete ERP Modules', action: 'delete' },
  { module: 'subscription', code: 'plan_modules:view', name: 'View Plan Modules', action: 'view' },
  { module: 'subscription', code: 'plan_modules:manage', name: 'Manage Plan Modules', action: 'manage' },
  { module: 'subscription', code: 'company_subscriptions:view', name: 'View Company Subscriptions', action: 'view' },
  { module: 'subscription', code: 'company_subscriptions:create', name: 'Create Company Subscriptions', action: 'create' },
  { module: 'subscription', code: 'company_subscriptions:edit', name: 'Edit Company Subscriptions', action: 'edit' },
  { module: 'subscription', code: 'company_subscriptions:delete', name: 'Delete Company Subscriptions', action: 'delete' },
  { module: 'subscription', code: 'company_modules:view', name: 'View Company Modules', action: 'view' },
  { module: 'subscription', code: 'company_modules:create', name: 'Create Company Modules', action: 'create' },
  { module: 'subscription', code: 'company_modules:edit', name: 'Edit Company Modules', action: 'edit' },
  { module: 'subscription', code: 'company_modules:delete', name: 'Delete Company Modules', action: 'delete' },
  { module: 'platform', code: 'super_admins:view', name: 'View Super Admins', action: 'view' },
  { module: 'platform', code: 'super_admins:create', name: 'Create Super Admins', action: 'create' },
  { module: 'platform', code: 'super_admins:edit', name: 'Edit Super Admins', action: 'edit' },
  { module: 'platform', code: 'super_admins:delete', name: 'Delete Super Admins', action: 'delete' },
  { module: 'platform', code: 'platform_companies:view', name: 'View Platform Companies', action: 'view' },
  { module: 'platform', code: 'platform_companies:edit', name: 'Manage Platform Companies', action: 'edit' },
] as const;

export const PERMISSIONS = [
  ...ADMIN_PERMISSIONS,
  ...PRODUCT_PERMISSIONS,
  ...SUPPLY_CHAIN_RESOURCE_PERMISSIONS,
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const SUPER_ADMIN_PERMISSIONS = [
  'super_admins:view',
  'super_admins:create',
  'super_admins:edit',
  'super_admins:delete',
  'platform_companies:view',
  'platform_companies:edit',
] as const satisfies readonly PermissionCode[];

export const DEFAULT_ADMIN_PERMISSIONS: PermissionCode[] = PERMISSIONS.filter(
  (p) => p.module !== 'platform',
).map((p) => p.code);
