/**
 * Product-level System Role Template registry (config — not a DB table).
 *
 * Each company gets its OWN roles row cloned from these templates.
 * Identity across tenants: systemTemplateKey (never roleName).
 * PLATFORM_OWNER is platform-scope only — never provisioned into customer companies.
 *
 * Future ERP updates: bump templateVersion and run an explicit migration job
 * that targets roles WHERE systemTemplateKey = X; never auto-overwrite Custom roles.
 */

export type SystemRoleTemplateScope = 'platform' | 'company';

export interface SystemRoleTemplate {
  /** Stable product identity — e.g. MANAGER */
  templateKey: string;
  defaultRoleCode: string;
  defaultRoleName: string;
  description?: string;
  /** Empty = always provision for customer companies. Else all listed product moduleCodes must be entitled. */
  requiredModules: string[];
  scope: SystemRoleTemplateScope;
  /** Bump when default permission pack changes (documentation / future migrator). */
  templateVersion: number;
}

/** Core pack — always created for every customer company. */
export const CORE_COMPANY_SYSTEM_TEMPLATE_KEYS = ['ADMIN', 'MANAGER', 'STAFF'] as const;

export const SYSTEM_ROLE_TEMPLATES: SystemRoleTemplate[] = [
  {
    templateKey: 'PLATFORM_OWNER',
    defaultRoleCode: 'PLATFORM_OWNER',
    defaultRoleName: 'Platform Owner',
    description: 'Clarity platform administration (platform company only)',
    requiredModules: [],
    scope: 'platform',
    templateVersion: 1,
  },
  {
    templateKey: 'ADMIN',
    defaultRoleCode: 'ADMIN',
    defaultRoleName: 'Administrator',
    description: 'Company administrator',
    requiredModules: [],
    scope: 'company',
    templateVersion: 2,
  },
  {
    templateKey: 'MANAGER',
    defaultRoleCode: 'MANAGER',
    defaultRoleName: 'Manager',
    description: 'Company manager',
    requiredModules: [],
    scope: 'company',
    templateVersion: 2,
  },
  {
    templateKey: 'STAFF',
    defaultRoleCode: 'STAFF',
    defaultRoleName: 'Staff',
    description: 'Company staff',
    requiredModules: [],
    scope: 'company',
    templateVersion: 2,
  },
  {
    templateKey: 'SALES',
    defaultRoleCode: 'SALES',
    defaultRoleName: 'Sales Executive',
    description: 'Sales (CRM)',
    requiredModules: ['crm'],
    scope: 'company',
    templateVersion: 2,
  },
  {
    templateKey: 'VENDOR',
    defaultRoleCode: 'VENDOR',
    defaultRoleName: 'Vendor User',
    description: 'Vendor / purchasing user',
    requiredModules: ['supply-chain'],
    scope: 'company',
    templateVersion: 2,
  },
  {
    templateKey: 'INVENTORY_ADMIN',
    defaultRoleCode: 'INVENTORY_ADMIN',
    defaultRoleName: 'Inventory Admin',
    description: 'Inventory / item master admin',
    requiredModules: ['supply-chain'],
    scope: 'company',
    templateVersion: 2,
  },
];

export function getSystemRoleTemplate(templateKey: string): SystemRoleTemplate | undefined {
  return SYSTEM_ROLE_TEMPLATES.find((t) => t.templateKey === templateKey);
}

/**
 * Templates to materialize for a customer company given entitled product module codes.
 * Never includes PLATFORM_OWNER.
 */
export function resolveCompanySystemTemplates(moduleCodes: string[] = []): SystemRoleTemplate[] {
  const entitled = new Set(moduleCodes.map((c) => c.trim().toLowerCase()).filter(Boolean));

  return SYSTEM_ROLE_TEMPLATES.filter((t) => {
    if (t.scope !== 'company') return false;
    if (t.requiredModules.length === 0) return true;
    return t.requiredModules.every((m) => entitled.has(m.toLowerCase()));
  });
}
