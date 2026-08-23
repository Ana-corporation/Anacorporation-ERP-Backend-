/**
 * Client-side login test accounts (matches frontend auth expectations).
 *
 * Prerequisites:
 *   npx prisma migrate deploy
 *   npm run seed:erp-modules
 *
 * Run:
 *   npm run seed:client-logins
 *
 * Accounts:
 *   PLATFORM  / OWNER001  / Owner@123   → platform owner (admin nav)
 *   DEMO_ACME / ADMIN001  / Admin@123   → company ADMIN (supply-chain full)
 *   DEMO_ACME / MGR001    / Manager@123 → MANAGER (role may list future modules; workspace = entitled only)
 *   DEMO_ACME / STAFF001  / Staff@123   → STAFF (supply-chain view; crm role reserved until AVAILABLE)
 *   DEMO_ACME / SALES001  / Sales@123   → SALES (crm role reserved until AVAILABLE)
 *   DEMO_ACME / VENDOR001 / Vendor@123  → VENDOR (supply-chain vendors CRUD)
 *   DEMO_ACME / INV001    / InvAdmin@123 → INVENTORY_ADMIN (Item Master / supply-chain)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

// Prefer direct (non-pooler) URL for long seed transactions on Neon
if (process.env.DIRECT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
}

const prisma = new PrismaClient();

const PRODUCT_MODULE_CODES = [
  'financials',
  'supply-chain',
  'hcm',
  'manufacturing',
  'crm',
  'projects',
];

/** Customer-ready workspace modules (Vendors + Items → FE moduleCode supply-chain). */
const AVAILABLE_PRODUCT_MODULE_CODES = ['supply-chain'];

const PHASE1_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];

const CUSTOM_FIELDS_PERMISSION_CODES = [
  { module: 'shared', code: 'custom_fields:view', name: 'View Custom Fields', action: 'view' },
  { module: 'shared', code: 'custom_fields:create', name: 'Create Custom Fields', action: 'create' },
  { module: 'shared', code: 'custom_fields:edit', name: 'Edit Custom Fields', action: 'edit' },
  { module: 'shared', code: 'custom_fields:delete', name: 'Delete Custom Fields', action: 'delete' },
];

const FORM_CONFIGURATION_PERMISSION_CODES = [
  { module: 'shared', code: 'form_configurations:view', name: 'View Form Configurations', action: 'view' },
  { module: 'shared', code: 'form_configurations:edit', name: 'Edit Form Configurations', action: 'edit' },
];

/** Company Organization tab — branches / departments / designations / warehouses */
const ORG_STRUCTURE_PERMISSION_CODES = [
  { module: 'organization', code: 'branches:view', name: 'View Branches', action: 'view' },
  { module: 'organization', code: 'branches:create', name: 'Create Branches', action: 'create' },
  { module: 'organization', code: 'branches:edit', name: 'Edit Branches', action: 'edit' },
  { module: 'organization', code: 'branches:delete', name: 'Delete Branches', action: 'delete' },
  { module: 'organization', code: 'departments:view', name: 'View Departments', action: 'view' },
  { module: 'organization', code: 'departments:create', name: 'Create Departments', action: 'create' },
  { module: 'organization', code: 'departments:edit', name: 'Edit Departments', action: 'edit' },
  { module: 'organization', code: 'departments:delete', name: 'Delete Departments', action: 'delete' },
  { module: 'organization', code: 'designations:view', name: 'View Designations', action: 'view' },
  { module: 'organization', code: 'designations:create', name: 'Create Designations', action: 'create' },
  { module: 'organization', code: 'designations:edit', name: 'Edit Designations', action: 'edit' },
  { module: 'organization', code: 'designations:delete', name: 'Delete Designations', action: 'delete' },
  { module: 'organization', code: 'warehouses:view', name: 'View Warehouses', action: 'view' },
  { module: 'organization', code: 'warehouses:create', name: 'Create Warehouses', action: 'create' },
  { module: 'organization', code: 'warehouses:edit', name: 'Edit Warehouses', action: 'edit' },
  { module: 'organization', code: 'warehouses:delete', name: 'Delete Warehouses', action: 'delete' },
];

/** Company IAM — Users / Roles (tenant admin shell) */
const TENANT_IAM_PERMISSION_CODES = [
  { module: 'iam', code: 'users:view', name: 'View Users', action: 'view' },
  { module: 'iam', code: 'users:create', name: 'Create Users', action: 'create' },
  { module: 'iam', code: 'users:edit', name: 'Edit Users', action: 'edit' },
  { module: 'iam', code: 'users:delete', name: 'Delete Users', action: 'delete' },
  { module: 'iam', code: 'roles:view', name: 'View Roles', action: 'view' },
  { module: 'iam', code: 'roles:create', name: 'Create Roles', action: 'create' },
  { module: 'iam', code: 'roles:edit', name: 'Edit Roles', action: 'edit' },
  { module: 'iam', code: 'roles:delete', name: 'Delete Roles', action: 'delete' },
  // Security & Organization V1 — required for Permission Sets / Access Policies tabs
  { module: 'iam', code: 'permission_sets:view', name: 'View Permission Sets', action: 'view' },
  { module: 'iam', code: 'permission_sets:create', name: 'Create Permission Sets', action: 'create' },
  { module: 'iam', code: 'permission_sets:edit', name: 'Edit Permission Sets', action: 'edit' },
  { module: 'iam', code: 'permission_sets:delete', name: 'Delete Permission Sets', action: 'delete' },
  { module: 'iam', code: 'data_access_policies:view', name: 'View Data Access Policies', action: 'view' },
  { module: 'iam', code: 'data_access_policies:create', name: 'Create Data Access Policies', action: 'create' },
  { module: 'iam', code: 'data_access_policies:edit', name: 'Edit Data Access Policies', action: 'edit' },
  { module: 'iam', code: 'data_access_policies:delete', name: 'Delete Data Access Policies', action: 'delete' },
];

/** Platform owner flat permissions expected by frontend Administration nav */
const PLATFORM_OWNER_PERMISSION_CODES = [
  { module: 'organization', code: 'companies:view', name: 'View Companies', action: 'view' },
  { module: 'organization', code: 'companies:create', name: 'Create Companies', action: 'create' },
  { module: 'organization', code: 'companies:edit', name: 'Edit Companies', action: 'edit' },
  { module: 'organization', code: 'companies:delete', name: 'Delete Companies', action: 'delete' },
  { module: 'platform', code: 'platform_companies:view', name: 'View Platform Companies', action: 'view' },
  { module: 'platform', code: 'platform_companies:edit', name: 'Manage Platform Companies', action: 'edit' },
  { module: 'iam', code: 'user_audit:view', name: 'View User Audit', action: 'view' },
  // FE aliases (in addition to backend subscription_* codes)
  { module: 'subscription', code: 'subscription:view', name: 'View Subscription', action: 'view' },
  { module: 'subscription', code: 'subscription:edit', name: 'Edit Subscription', action: 'edit' },
  { module: 'subscription', code: 'modules:view', name: 'View Modules', action: 'view' },
  { module: 'subscription', code: 'modules:edit', name: 'Edit Modules', action: 'edit' },
  { module: 'subscription', code: 'plans:view', name: 'View Plans', action: 'view' },
  { module: 'subscription', code: 'plans:edit', name: 'Edit Plans', action: 'edit' },
  { module: 'subscription', code: 'subscription_plans:view', name: 'View Subscription Plans', action: 'view' },
  { module: 'subscription', code: 'subscription_plans:create', name: 'Create Subscription Plans', action: 'create' },
  { module: 'subscription', code: 'subscription_plans:edit', name: 'Edit Subscription Plans', action: 'edit' },
  { module: 'subscription', code: 'subscription_plans:delete', name: 'Delete Subscription Plans', action: 'delete' },
  { module: 'subscription', code: 'subscription_modules:view', name: 'View ERP Modules', action: 'view' },
  { module: 'subscription', code: 'subscription_modules:create', name: 'Create ERP Modules', action: 'create' },
  { module: 'subscription', code: 'subscription_modules:edit', name: 'Edit ERP Modules', action: 'edit' },
  { module: 'subscription', code: 'subscription_modules:delete', name: 'Delete ERP Modules', action: 'delete' },
  { module: 'subscription', code: 'company_subscriptions:view', name: 'View Company Subscriptions', action: 'view' },
  { module: 'subscription', code: 'company_subscriptions:create', name: 'Create Company Subscriptions', action: 'create' },
  { module: 'subscription', code: 'company_subscriptions:edit', name: 'Edit Company Subscriptions', action: 'edit' },
  { module: 'subscription', code: 'company_modules:view', name: 'View Company Modules', action: 'view' },
  { module: 'subscription', code: 'company_modules:edit', name: 'Edit Company Modules', action: 'edit' },
  { module: 'iam', code: 'users:view', name: 'View Users', action: 'view' },
  { module: 'iam', code: 'users:create', name: 'Create Users', action: 'create' },
  { module: 'iam', code: 'roles:view', name: 'View Roles', action: 'view' },
  ...CUSTOM_FIELDS_PERMISSION_CODES,
  ...ORG_STRUCTURE_PERMISSION_CODES,
];

const ADMIN_EXTRA_PERMISSION_CODES = [
  ...CUSTOM_FIELDS_PERMISSION_CODES,
  ...FORM_CONFIGURATION_PERMISSION_CODES,
  ...ORG_STRUCTURE_PERMISSION_CODES,
  ...TENANT_IAM_PERMISSION_CODES,
];

const ACCOUNTS = [
  {
    level: 'platform-owner',
    companyCode: 'PLATFORM',
    companyName: 'Clarity Platform',
    companyStatus: 'active',
    planCode: 'PLATFORM',
    planName: 'Platform',
    productModules: [], // no workspace modules
    employeeCode: 'OWNER001',
    password: 'Owner@123',
    username: 'platform.owner',
    email: 'owner@clarity-erp.com',
    firstName: 'Platform',
    lastName: 'Owner',
    roleCode: 'PLATFORM_OWNER',
    roleName: 'Platform Owner',
    modulePermissions: {}, // product modules empty
    platformPermissionCodes: PLATFORM_OWNER_PERMISSION_CODES.map((p) => p.code),
  },
  {
    level: 'company-admin',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'active',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: AVAILABLE_PRODUCT_MODULE_CODES,
    employeeCode: 'ADMIN001',
    password: 'Admin@123',
    username: 'demo.admin',
    email: 'admin@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Admin',
    roleCode: 'ADMIN',
    roleName: 'Administrator',
    modulePermissions: {},
    resourcePermissionCodes: [
      'vendors:view',
      'vendors:create',
      'vendors:edit',
      'vendors:delete',
      'vendors:approve',
      'items:view',
      'items:create',
      'items:edit',
      'items:delete',
      'items:approve',
    ],
    platformPermissionCodes: ADMIN_EXTRA_PERMISSION_CODES.map((p) => p.code),
  },
  {
    level: 'manager',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'active',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: AVAILABLE_PRODUCT_MODULE_CODES,
    employeeCode: 'MGR001',
    password: 'Manager@123',
    username: 'demo.manager',
    email: 'manager@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Manager',
    roleCode: 'MANAGER',
    roleName: 'Manager',
    modulePermissions: {},
    resourcePermissionCodes: [
      'vendors:view',
      'vendors:create',
      'vendors:edit',
      'items:view',
      'items:create',
      'items:edit',
    ],
    denyOtherModules: true,
    platformPermissionCodes: [],
  },
  {
    level: 'staff',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'active',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: AVAILABLE_PRODUCT_MODULE_CODES,
    employeeCode: 'STAFF001',
    password: 'Staff@123',
    username: 'demo.staff',
    email: 'staff@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Staff',
    roleCode: 'STAFF',
    roleName: 'Staff',
    modulePermissions: {},
    resourcePermissionCodes: ['vendors:view', 'items:view'],
    denyOtherModules: true,
    platformPermissionCodes: [],
  },
  {
    level: 'sales',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'active',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: AVAILABLE_PRODUCT_MODULE_CODES,
    employeeCode: 'SALES001',
    password: 'Sales@123',
    username: 'demo.sales',
    email: 'sales@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Sales',
    roleCode: 'SALES',
    roleName: 'Sales Executive',
    modulePermissions: {},
    resourcePermissionCodes: ['vendors:view', 'items:view'],
    denyOtherModules: true,
    platformPermissionCodes: [],
  },
  {
    level: 'vendor',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'active',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: AVAILABLE_PRODUCT_MODULE_CODES,
    employeeCode: 'VENDOR001',
    password: 'Vendor@123',
    username: 'demo.vendor',
    email: 'vendor@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Vendor',
    roleCode: 'VENDOR',
    roleName: 'Vendor User',
    modulePermissions: {},
    resourcePermissionCodes: [
      'vendors:view',
      'vendors:create',
      'vendors:edit',
      'vendors:delete',
    ],
    denyOtherModules: true,
    platformPermissionCodes: [],
  },
  {
    level: 'inventory-admin',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'active',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: AVAILABLE_PRODUCT_MODULE_CODES,
    employeeCode: 'INV001',
    password: 'InvAdmin@123',
    username: 'demo.inventory',
    email: 'inventory@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Inventory',
    roleCode: 'INVENTORY_ADMIN',
    roleName: 'Inventory Admin',
    modulePermissions: {},
    resourcePermissionCodes: [
      'items:view',
      'items:create',
      'items:edit',
      'items:delete',
    ],
    denyOtherModules: true,
    platformPermissionCodes: [],
  },
];

async function ensureModules() {
  const admin = [
    { code: 'shared', name: 'Shared Master Data', moduleType: 'admin', sortOrder: 1 },
    { code: 'organization', name: 'Organization', moduleType: 'admin', sortOrder: 2 },
    { code: 'iam', name: 'Identity & Access', moduleType: 'admin', sortOrder: 3 },
    { code: 'subscription', name: 'Subscription & Billing', moduleType: 'admin', sortOrder: 4 },
    { code: 'platform', name: 'Platform', moduleType: 'admin', sortOrder: 5 },
  ];
  const product = [
    { code: 'financials', name: 'Financials', moduleType: 'product', sortOrder: 10, icon: 'finance', lifecycleStatus: 'DEVELOPMENT' },
    { code: 'supply-chain', name: 'Supply Chain', moduleType: 'product', sortOrder: 11, icon: 'supply', lifecycleStatus: 'AVAILABLE' },
    { code: 'hcm', name: 'HCM', moduleType: 'product', sortOrder: 12, icon: 'people', lifecycleStatus: 'DEVELOPMENT' },
    { code: 'manufacturing', name: 'Manufacturing', moduleType: 'product', sortOrder: 13, icon: 'factory', lifecycleStatus: 'DEVELOPMENT' },
    { code: 'crm', name: 'CRM', moduleType: 'product', sortOrder: 14, icon: 'crm', lifecycleStatus: 'DEVELOPMENT' },
    { code: 'projects', name: 'Projects', moduleType: 'product', sortOrder: 15, icon: 'projects', lifecycleStatus: 'DEVELOPMENT' },
  ];

  for (const mod of [...admin.map((m) => ({ ...m, lifecycleStatus: 'INTERNAL' })), ...product]) {
    await prisma.module.upsert({
      where: { moduleCode: mod.code },
      update: {
        moduleName: mod.name,
        moduleType: mod.moduleType,
        sortOrder: mod.sortOrder,
        icon: mod.icon ?? null,
        lifecycleStatus: mod.lifecycleStatus,
        isActive: true,
      },
      create: {
        moduleCode: mod.code,
        moduleName: mod.name,
        moduleType: mod.moduleType,
        sortOrder: mod.sortOrder,
        icon: mod.icon ?? null,
        lifecycleStatus: mod.lifecycleStatus,
        isActive: true,
      },
    });
  }

  const productModules = await prisma.module.findMany({
    where: { moduleCode: { in: PRODUCT_MODULE_CODES } },
  });

  for (const row of productModules) {
    for (const action of PHASE1_ACTIONS) {
      const permissionCode = `${row.moduleCode}:${action}`;
      await prisma.permission.upsert({
        where: {
          moduleId_permissionCode: { moduleId: row.moduleId, permissionCode },
        },
        update: { action, permissionName: `${row.moduleName} — ${action}` },
        create: {
          moduleId: row.moduleId,
          permissionCode,
          permissionName: `${row.moduleName} — ${action}`,
          action,
        },
      });
    }
  }

  // Supply Chain resource-level permissions (vendors / items) under module supply-chain
  const supplyChain = productModules.find((m) => m.moduleCode === 'supply-chain');
  if (supplyChain) {
    const resources = [
      { resource: 'vendors', label: 'Vendors' },
      { resource: 'items', label: 'Items' },
    ];
    for (const { resource, label } of resources) {
      for (const action of PHASE1_ACTIONS) {
        const permissionCode = `${resource}:${action}`;
        await prisma.permission.upsert({
          where: {
            moduleId_permissionCode: {
              moduleId: supplyChain.moduleId,
              permissionCode,
            },
          },
          update: {
            action,
            permissionName: `${label} — ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
          },
          create: {
            moduleId: supplyChain.moduleId,
            permissionCode,
            permissionName: `${label} — ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
            action,
          },
        });
      }
    }
  }

  const modulesByCode = new Map(
    (await prisma.module.findMany()).map((m) => [m.moduleCode, m]),
  );

  const flatPermissions = [
    ...PLATFORM_OWNER_PERMISSION_CODES,
    ...CUSTOM_FIELDS_PERMISSION_CODES,
    ...FORM_CONFIGURATION_PERMISSION_CODES,
    ...ORG_STRUCTURE_PERMISSION_CODES,
    ...TENANT_IAM_PERMISSION_CODES,
  ];
  const seenPermCodes = new Set();
  for (const perm of flatPermissions) {
    if (seenPermCodes.has(perm.code)) continue;
    seenPermCodes.add(perm.code);
    const mod = modulesByCode.get(perm.module);
    if (!mod) continue;
    await prisma.permission.upsert({
      where: {
        moduleId_permissionCode: {
          moduleId: mod.moduleId,
          permissionCode: perm.code,
        },
      },
      update: { action: perm.action, permissionName: perm.name },
      create: {
        moduleId: mod.moduleId,
        permissionCode: perm.code,
        permissionName: perm.name,
        action: perm.action,
      },
    });
  }

  return modulesByCode;
}

async function ensureCompany(tx, account, createdBy) {
  let company = await tx.company.findUnique({
    where: { companyCode: account.companyCode },
  });

  if (!company) {
    company = await tx.company.create({
      data: {
        companyCode: account.companyCode,
        name: account.companyName,
        status: account.companyStatus,
      },
    });
  } else {
    company = await tx.company.update({
      where: { companyId: company.companyId },
      data: {
        name: account.companyName,
        status: account.companyStatus,
        deletedAt: null,
      },
    });
  }

  return company;
}

async function ensurePlan(tx, account, modulesByCode) {
  let plan = await tx.subscriptionPlan.findUnique({
    where: { planCode: account.planCode },
  });

  if (!plan) {
    plan = await tx.subscriptionPlan.create({
      data: {
        planCode: account.planCode,
        name: account.planName,
        description: `${account.planName} (client login samples)`,
        price: 0,
        billingCycle: 'monthly',
        isActive: true,
      },
    });
  }

  for (const code of account.productModules) {
    const mod = modulesByCode.get(code);
    if (!mod) continue;
    await tx.planModule.upsert({
      where: {
        planId_moduleId: { planId: plan.planId, moduleId: mod.moduleId },
      },
      update: {},
      create: { planId: plan.planId, moduleId: mod.moduleId },
    });
  }

  return plan;
}

/** ACTIVE company_modules only for AVAILABLE product modules the company should have. */
async function ensureCompanyModules(tx, companyId, account, modulesByCode, createdBy) {
  const entitled = new Set(account.productModules || []);

  for (const code of PRODUCT_MODULE_CODES) {
    const mod = modulesByCode.get(code);
    if (!mod) continue;

    const isActive = entitled.has(code) && AVAILABLE_PRODUCT_MODULE_CODES.includes(code);
    await tx.companyModule.upsert({
      where: {
        companyId_moduleId: { companyId, moduleId: mod.moduleId },
      },
      update: {
        isActive,
        deletedAt: null,
        activatedDate: isActive ? new Date() : undefined,
        updatedAt: new Date(),
        updatedBy: createdBy,
      },
      create: {
        companyId,
        moduleId: mod.moduleId,
        isActive,
        activatedDate: new Date(),
        createdBy,
      },
    });
  }
}

async function ensureSubscription(tx, companyId, planId, createdBy, status) {
  const existing = await tx.companySubscription.findFirst({
    where: {
      companyId,
      status: { in: ['trial', 'active'] },
      deletedAt: null,
    },
    orderBy: { companySubscriptionId: 'desc' },
  });

  const today = new Date();
  const end = new Date(today);
  end.setFullYear(end.getFullYear() + 1);

  if (existing) {
    return tx.companySubscription.update({
      where: { companySubscriptionId: existing.companySubscriptionId },
      data: {
        planId,
        status,
        startDate: today,
        endDate: end,
        updatedAt: new Date(),
      },
    });
  }

  return tx.companySubscription.create({
    data: {
      companyId,
      planId,
      startDate: today,
      endDate: end,
      status,
      amount: 0,
      createdBy,
    },
  });
}

async function ensureUser(tx, account, passwordHash) {
  let user = await tx.user.findFirst({
    where: {
      OR: [{ email: account.email }, { username: account.username }],
      deletedAt: null,
    },
  });

  if (!user) {
    user = await tx.user.create({
      data: {
        username: account.username,
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        displayName: `${account.firstName} ${account.lastName}`,
        isActive: true,
        isLocked: false,
      },
    });
  } else {
    user = await tx.user.update({
      where: { userId: user.userId },
      data: {
        username: account.username,
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        displayName: `${account.firstName} ${account.lastName}`,
        isActive: true,
        isLocked: false,
        deletedAt: null,
      },
    });
  }

  const auth = await tx.userAuthentication.findUnique({
    where: { userId: user.userId },
  });

  if (!auth) {
    await tx.userAuthentication.create({
      data: {
        userId: user.userId,
        passwordHash,
        isEmailVerified: true,
        failedLoginCount: 0,
      },
    });
  } else {
    await tx.userAuthentication.update({
      where: { userId: user.userId },
      data: {
        passwordHash,
        isEmailVerified: true,
        failedLoginCount: 0,
        accountLockedUntil: null,
        updatedAt: new Date(),
      },
    });
  }

  return user;
}

async function ensureRole(tx, companyId, account, createdBy) {
  let role = await tx.role.findUnique({
    where: {
      companyId_roleCode: { companyId, roleCode: account.roleCode },
    },
  });

  if (!role) {
    role = await tx.role.create({
      data: {
        companyId,
        roleCode: account.roleCode,
        roleName: account.roleName,
        isSystem: true,
        roleType: 'SYSTEM',
        systemTemplateKey: account.roleCode,
        createdBy,
      },
    });
  } else {
    role = await tx.role.update({
      where: { roleId: role.roleId },
      data: {
        roleName: account.roleName,
        isSystem: true,
        roleType: 'SYSTEM',
        systemTemplateKey: account.roleCode,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  return role;
}

async function replaceRolePermissions(tx, roleId, account, modulesByCode, createdBy) {
  await tx.rolePermission.deleteMany({ where: { roleId } });

  const permissionCodes = new Set();

  for (const [moduleCode, actions] of Object.entries(account.modulePermissions ?? {})) {
    for (const action of actions) {
      const moduleLevel = `${moduleCode}:${action}`;
      permissionCodes.add(moduleLevel);
      // Expand legacy supply-chain:* → vendors:* + items:* (migration-safe)
      if (moduleCode === 'supply-chain') {
        permissionCodes.add(`vendors:${action}`);
        permissionCodes.add(`items:${action}`);
      }
    }
  }
  for (const code of account.resourcePermissionCodes ?? []) {
    permissionCodes.add(code);
  }
  for (const code of account.platformPermissionCodes ?? []) {
    permissionCodes.add(code);
  }

  if (permissionCodes.size === 0) return;

  const permissions = await tx.permission.findMany({
    where: { permissionCode: { in: [...permissionCodes] } },
  });

  if (permissions.length === 0) return;

  await tx.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId,
      moduleId: permission.moduleId,
      permissionId: permission.permissionId,
      isAllowed: true,
      createdBy,
    })),
    skipDuplicates: true,
  });
}

async function ensureMembership(tx, userId, companyId, account, createdBy) {
  const membership = await tx.userCompany.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });

  if (!membership) {
    await tx.userCompany.create({
      data: {
        userId,
        companyId,
        employeeId: account.employeeCode,
        status: 'active',
        isDefault: true,
        createdBy,
      },
    });
  } else {
    await tx.userCompany.update({
      where: { userCompanyId: membership.userCompanyId },
      data: {
        employeeId: account.employeeCode,
        status: 'active',
        isDefault: true,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  // Clear other employeeId collisions in same company
  await tx.userCompany.updateMany({
    where: {
      companyId,
      employeeId: account.employeeCode,
      NOT: { userId },
    },
    data: { employeeId: null },
  });
}

async function ensureUserRole(tx, userId, companyId, roleId, assignedBy) {
  const existing = await tx.userRole.findFirst({
    where: {
      userId,
      companyId,
      roleId,
      isActive: true,
      endedAt: null,
    },
    orderBy: { userRoleId: 'desc' },
  });

  const inactiveExisting = existing
    ? null
    : await tx.userRole.findFirst({
        where: { userId, companyId, roleId },
        orderBy: { userRoleId: 'desc' },
      });

  const row = existing ?? inactiveExisting;

  if (!row) {
    await tx.userRole.updateMany({
      where: { userId, companyId, isActive: true, endedAt: null },
      data: {
        isActive: false,
        endedAt: new Date(),
        endReason: 'REASSIGNED',
      },
    });
    await tx.userRole.create({
      data: {
        userId,
        companyId,
        roleId,
        assignedBy,
        isActive: true,
        endedAt: null,
        endedBy: null,
        endReason: null,
      },
    });
  } else {
    await tx.userRole.updateMany({
      where: {
        userId,
        companyId,
        isActive: true,
        endedAt: null,
        NOT: { userRoleId: row.userRoleId },
      },
      data: {
        isActive: false,
        endedAt: new Date(),
        endReason: 'REASSIGNED',
      },
    });
    await tx.userRole.update({
      where: { userRoleId: row.userRoleId },
      data: {
        isActive: true,
        endedAt: null,
        endedBy: null,
        endReason: null,
      },
    });
  }
}

function resolveAllowedProductModules(account) {
  const allowed = new Set(Object.keys(account.modulePermissions ?? {}));
  for (const code of account.resourcePermissionCodes ?? []) {
    if (/^(vendors|items):/.test(code)) {
      allowed.add('supply-chain');
    }
  }
  return allowed;
}

async function ensureModuleAccessOverrides(tx, userId, companyId, account, modulesByCode, createdBy) {
  await tx.userModuleAccess.deleteMany({ where: { userId, companyId } });

  if (!account.denyOtherModules) return;

  const allowed = resolveAllowedProductModules(account);
  const rows = [];
  for (const code of PRODUCT_MODULE_CODES) {
    if (allowed.has(code)) continue;
    const mod = modulesByCode.get(code);
    if (!mod) continue;
    rows.push({
      userId,
      companyId,
      moduleId: mod.moduleId,
      accessType: 'deny',
      reason: 'Client login sample — role module restriction',
      createdBy,
    });
  }

  if (rows.length > 0) {
    await tx.userModuleAccess.createMany({ data: rows, skipDuplicates: true });
  }
}

async function seedAccount(account, modulesByCode) {
  const passwordHash = await bcrypt.hash(account.password, 12);

  return prisma.$transaction(
    async (tx) => {
      const company = await ensureCompany(tx, account);
      const plan = await ensurePlan(tx, account, modulesByCode);
      const user = await ensureUser(tx, account, passwordHash);

      await ensureSubscription(
        tx,
        company.companyId,
        plan.planId,
        user.userId,
        account.companyStatus === 'active' ? 'active' : 'trial',
      );

      if (account.level !== 'platform-owner') {
        await ensureCompanyModules(
          tx,
          company.companyId,
          account,
          modulesByCode,
          user.userId,
        );
      }

      const role = await ensureRole(tx, company.companyId, account, user.userId);
      await replaceRolePermissions(tx, role.roleId, account, modulesByCode, user.userId);
      await ensureMembership(tx, user.userId, company.companyId, account, user.userId);
      await ensureUserRole(tx, user.userId, company.companyId, role.roleId, user.userId);
      await ensureModuleAccessOverrides(
        tx,
        user.userId,
        company.companyId,
        account,
        modulesByCode,
        user.userId,
      );

      return {
        companyCode: company.companyCode,
        companyId: company.companyId.toString(),
        employeeCode: account.employeeCode,
        password: account.password,
        roleCode: account.roleCode,
        email: account.email,
      };
    },
    { maxWait: 20000, timeout: 60000 },
  );
}

async function ensureVendorCustomFieldSamples() {
  const company = await prisma.company.findUnique({ where: { companyCode: 'DEMO_ACME' } });
  if (!company) return;

  // Deactivate colliding legacy demo field (paymentTerms overlaps SAP metadata tab)
  await prisma.customFieldDefinition.updateMany({
    where: {
      companyId: company.companyId,
      entityType: 'vendor',
      fieldName: 'paymentTerms',
      deletedAt: null,
    },
    data: {
      isActive: false,
      deletedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const samples = [
    {
      fieldName: 'vendorTier',
      displayName: 'Vendor tier',
      fieldType: 'dropdown',
      sectionKey: 'general',
      isRequired: true,
      isFilterable: true,
      sortOrder: 10,
      options: [
        { value: 'strategic', label: 'Strategic partner' },
        { value: 'preferred', label: 'Preferred supplier' },
        { value: 'spot', label: 'Spot / one-time vendor' },
      ],
      defaultValue: 'preferred',
    },
    {
      fieldName: 'preferredCurrency',
      displayName: 'Billing currency (custom)',
      fieldType: 'text',
      sectionKey: 'custom',
      isRequired: false,
      isFilterable: false,
      sortOrder: 20,
      validation: { maxLength: 3, minLength: 3 },
    },
    {
      fieldName: 'isPreferredVendor',
      displayName: 'Mark as preferred vendor',
      fieldType: 'checkbox',
      sectionKey: 'custom',
      isRequired: false,
      isFilterable: true,
      sortOrder: 30,
      defaultValue: false,
    },
  ];

  for (const sample of samples) {
    await prisma.customFieldDefinition.upsert({
      where: {
        companyId_entityType_fieldName: {
          companyId: company.companyId,
          entityType: 'vendor',
          fieldName: sample.fieldName,
        },
      },
      update: {
        displayName: sample.displayName,
        fieldType: sample.fieldType,
        sectionKey: sample.sectionKey,
        isRequired: sample.isRequired,
        isFilterable: sample.isFilterable,
        sortOrder: sample.sortOrder,
        options: sample.options ?? undefined,
        validation: sample.validation ?? undefined,
        defaultValue: sample.defaultValue ?? undefined,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date(),
      },
      create: {
        companyId: company.companyId,
        entityType: 'vendor',
        fieldName: sample.fieldName,
        displayName: sample.displayName,
        fieldType: sample.fieldType,
        sectionKey: sample.sectionKey,
        isRequired: sample.isRequired,
        isFilterable: sample.isFilterable,
        sortOrder: sample.sortOrder,
        options: sample.options ?? undefined,
        validation: sample.validation ?? undefined,
        defaultValue: sample.defaultValue ?? undefined,
        isActive: true,
      },
    });
  }

  console.log('Vendor custom field samples ready for DEMO_ACME (paymentTerms deactivated).');
}

/** Demo Organization tab rows for DEMO_ACME (branches / depts / designations / warehouses). */
async function ensureDemoOrgStructure() {
  const company = await prisma.company.findUnique({ where: { companyCode: 'DEMO_ACME' } });
  if (!company) {
    console.warn('DEMO_ACME not found — skip org structure seed');
    return;
  }
  const companyId = company.companyId;

  const branches = [
    {
      branchCode: 'HQ',
      name: 'Head Office',
      address: '12 Anna Salai',
      city: 'Chennai',
      country: 'IN',
      phone: '+91-44-40000001',
    },
    {
      branchCode: 'BLR',
      name: 'Bangalore Branch',
      address: 'MG Road',
      city: 'Bengaluru',
      country: 'IN',
      phone: '+91-80-40000002',
    },
  ];

  const branchIds = {};
  for (const row of branches) {
    const saved = await prisma.branch.upsert({
      where: {
        companyId_branchCode: { companyId, branchCode: row.branchCode },
      },
      update: {
        name: row.name,
        address: row.address,
        city: row.city,
        country: row.country,
        phone: row.phone,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date(),
      },
      create: {
        companyId,
        ...row,
        isActive: true,
      },
    });
    branchIds[row.branchCode] = saved.branchId;
  }

  for (const row of [
    { departmentCode: 'OPS', name: 'Operations' },
    { departmentCode: 'FIN', name: 'Finance' },
    { departmentCode: 'SCM', name: 'Supply Chain' },
  ]) {
    await prisma.department.upsert({
      where: {
        companyId_departmentCode: { companyId, departmentCode: row.departmentCode },
      },
      update: {
        name: row.name,
        parentDepartmentId: null,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date(),
      },
      create: {
        companyId,
        departmentCode: row.departmentCode,
        name: row.name,
        parentDepartmentId: null,
        isActive: true,
      },
    });
  }

  for (const row of [
    { designationCode: 'ADMIN', name: 'Administrator', gradeLevel: 1 },
    { designationCode: 'MGR', name: 'Manager', gradeLevel: 2 },
    { designationCode: 'EXEC', name: 'Executive', gradeLevel: 3 },
  ]) {
    await prisma.designation.upsert({
      where: {
        companyId_designationCode: { companyId, designationCode: row.designationCode },
      },
      update: {
        name: row.name,
        gradeLevel: row.gradeLevel,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date(),
      },
      create: {
        companyId,
        ...row,
        isActive: true,
      },
    });
  }

  for (const row of [
    {
      warehouseCode: 'WH-HQ',
      name: 'Main Warehouse (HQ)',
      branchId: branchIds.HQ ?? null,
      address: 'Industrial Estate, Chennai',
    },
    {
      warehouseCode: 'WH-BLR',
      name: 'Bangalore Warehouse',
      branchId: branchIds.BLR ?? null,
      address: 'Peenya Industrial Area',
    },
  ]) {
    await prisma.warehouse.upsert({
      where: {
        companyId_warehouseCode: { companyId, warehouseCode: row.warehouseCode },
      },
      update: {
        name: row.name,
        branchId: row.branchId,
        address: row.address,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date(),
      },
      create: {
        companyId,
        warehouseCode: row.warehouseCode,
        name: row.name,
        branchId: row.branchId,
        address: row.address,
        isActive: true,
      },
    });
  }

  console.log('DEMO_ACME org structure ready (branches, departments, designations, warehouses).');
}

async function main() {
  console.log('Seeding client login sample accounts...\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in .env');
  }

  const modulesByCode = await ensureModules();
  console.log('Modules + permissions ready.\n');

  await ensureVendorCustomFieldSamples();

  const results = [];
  for (const account of ACCOUNTS) {
    const row = await seedAccount(account, modulesByCode);
    results.push(row);
    console.log(
      `✓ ${row.companyCode.padEnd(10)} / ${row.employeeCode.padEnd(10)} / ${row.password.padEnd(12)}  (${row.roleCode})`,
    );
  }

  await ensureDemoOrgStructure();

  console.log('\nDone. Test with POST /api/v1/auth/login:');
  console.log(
    JSON.stringify(
      {
        companyCode: results[1]?.companyCode ?? 'DEMO_ACME',
        employeeCode: results[1]?.employeeCode ?? 'ADMIN001',
        password: results[1]?.password ?? 'Admin@123',
      },
      null,
      2,
    ),
  );
  console.log(
    '\nADMIN001 now includes: org (branches/departments/designations/warehouses),',
  );
  console.log('  custom_fields:*, form_configurations:view|edit, tenant IAM + Security Org V1.');
  console.log('Re-login ADMIN001 after seed so permissions[] is fresh.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
