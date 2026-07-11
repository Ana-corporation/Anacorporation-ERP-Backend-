import { ModuleType } from '@prisma/client';

export const PHASE1_PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
] as const;

export type Phase1PermissionAction = (typeof PHASE1_PERMISSION_ACTIONS)[number];

export interface ModuleSeed {
  code: string;
  name: string;
  moduleType: ModuleType;
  sortOrder: number;
  description?: string;
  icon?: string;
}

/** Admin console areas — role-gated, never subscription snapshot. */
export const ADMIN_MODULES: ModuleSeed[] = [
  { code: 'shared', name: 'Shared Master Data', moduleType: 'admin', sortOrder: 1 },
  { code: 'organization', name: 'Organization', moduleType: 'admin', sortOrder: 2 },
  { code: 'iam', name: 'Identity & Access', moduleType: 'admin', sortOrder: 3 },
  { code: 'subscription', name: 'Subscription & Billing', moduleType: 'admin', sortOrder: 4 },
  { code: 'platform', name: 'Platform', moduleType: 'admin', sortOrder: 5 },
];

/** ERP product modules — subscription-gated, appear in login snapshot. */
export const PRODUCT_MODULES: ModuleSeed[] = [
  { code: 'financials', name: 'Financials', moduleType: 'product', sortOrder: 10, icon: 'finance' },
  { code: 'supply-chain', name: 'Supply Chain', moduleType: 'product', sortOrder: 11, icon: 'supply' },
  { code: 'hcm', name: 'HCM', moduleType: 'product', sortOrder: 12, icon: 'people' },
  { code: 'manufacturing', name: 'Manufacturing', moduleType: 'product', sortOrder: 13, icon: 'factory' },
  { code: 'crm', name: 'CRM', moduleType: 'product', sortOrder: 14, icon: 'crm' },
  { code: 'projects', name: 'Projects', moduleType: 'product', sortOrder: 15, icon: 'projects' },
];

export const ALL_MODULES: ModuleSeed[] = [...ADMIN_MODULES, ...PRODUCT_MODULES];

export const PRODUCT_MODULE_CODES = PRODUCT_MODULES.map((m) => m.code);
export const ADMIN_MODULE_CODES = ADMIN_MODULES.map((m) => m.code);
