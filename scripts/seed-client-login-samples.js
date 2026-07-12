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
 *   DEMO_ACME / ADMIN001  / Admin@123   → company ADMIN (all modules full)
 *   DEMO_ACME / MGR001    / Manager@123 → MANAGER (financials + crm partial)
 *   DEMO_ACME / STAFF001  / Staff@123   → STAFF (crm + supply-chain view)
 *   DEMO_ACME / SALES001  / Sales@123   → SALES (crm view/create/edit)
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

const PHASE1_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];

/** Platform owner flat permissions expected by frontend Administration nav */
const PLATFORM_OWNER_PERMISSION_CODES = [
  { module: 'organization', code: 'companies:view', name: 'View Companies', action: 'view' },
  { module: 'organization', code: 'companies:create', name: 'Create Companies', action: 'create' },
  { module: 'organization', code: 'companies:edit', name: 'Edit Companies', action: 'edit' },
  { module: 'organization', code: 'companies:delete', name: 'Delete Companies', action: 'delete' },
  // FE aliases (in addition to backend subscription_* codes)
  { module: 'subscription', code: 'subscription:view', name: 'View Subscription', action: 'view' },
  { module: 'subscription', code: 'subscription:edit', name: 'Edit Subscription', action: 'edit' },
  { module: 'subscription', code: 'modules:view', name: 'View Modules', action: 'view' },
  { module: 'subscription', code: 'modules:edit', name: 'Edit Modules', action: 'edit' },
  { module: 'subscription', code: 'plans:view', name: 'View Plans', action: 'view' },
  { module: 'subscription', code: 'plans:edit', name: 'Edit Plans', action: 'edit' },
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
    companyStatus: 'trial',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: PRODUCT_MODULE_CODES,
    employeeCode: 'ADMIN001',
    password: 'Admin@123',
    username: 'demo.admin',
    email: 'admin@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Admin',
    roleCode: 'ADMIN',
    roleName: 'Administrator',
    modulePermissions: {
      financials: ['view', 'create', 'edit', 'delete', 'approve'],
      'supply-chain': ['view', 'create', 'edit', 'delete', 'approve'],
      hcm: ['view', 'create', 'edit', 'delete', 'approve'],
      manufacturing: ['view', 'create', 'edit', 'delete', 'approve'],
      crm: ['view', 'create', 'edit', 'delete', 'approve'],
      projects: ['view', 'create', 'edit', 'delete', 'approve'],
    },
    platformPermissionCodes: [],
  },
  {
    level: 'manager',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'trial',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: PRODUCT_MODULE_CODES,
    employeeCode: 'MGR001',
    password: 'Manager@123',
    username: 'demo.manager',
    email: 'manager@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Manager',
    roleCode: 'MANAGER',
    roleName: 'Manager',
    modulePermissions: {
      financials: ['view', 'create', 'edit', 'approve'],
      crm: ['view', 'edit'],
    },
    denyOtherModules: true,
    platformPermissionCodes: [],
  },
  {
    level: 'staff',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'trial',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: PRODUCT_MODULE_CODES,
    employeeCode: 'STAFF001',
    password: 'Staff@123',
    username: 'demo.staff',
    email: 'staff@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Staff',
    roleCode: 'STAFF',
    roleName: 'Staff',
    modulePermissions: {
      'supply-chain': ['view'],
      crm: ['view'],
    },
    denyOtherModules: true,
    platformPermissionCodes: [],
  },
  {
    level: 'sales',
    companyCode: 'DEMO_ACME',
    companyName: 'Demo Acme Corp',
    companyStatus: 'trial',
    planCode: 'DEMO_STARTER',
    planName: 'Demo Starter',
    productModules: PRODUCT_MODULE_CODES,
    employeeCode: 'SALES001',
    password: 'Sales@123',
    username: 'demo.sales',
    email: 'sales@demo-acme.com',
    firstName: 'Demo',
    lastName: 'Sales',
    roleCode: 'SALES',
    roleName: 'Sales Executive',
    modulePermissions: {
      crm: ['view', 'create', 'edit'],
    },
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
    { code: 'financials', name: 'Financials', moduleType: 'product', sortOrder: 10, icon: 'finance' },
    { code: 'supply-chain', name: 'Supply Chain', moduleType: 'product', sortOrder: 11, icon: 'supply' },
    { code: 'hcm', name: 'HCM', moduleType: 'product', sortOrder: 12, icon: 'people' },
    { code: 'manufacturing', name: 'Manufacturing', moduleType: 'product', sortOrder: 13, icon: 'factory' },
    { code: 'crm', name: 'CRM', moduleType: 'product', sortOrder: 14, icon: 'crm' },
    { code: 'projects', name: 'Projects', moduleType: 'product', sortOrder: 15, icon: 'projects' },
  ];

  for (const mod of [...admin, ...product]) {
    await prisma.module.upsert({
      where: { moduleCode: mod.code },
      update: {
        moduleName: mod.name,
        moduleType: mod.moduleType,
        sortOrder: mod.sortOrder,
        icon: mod.icon ?? null,
        isActive: true,
      },
      create: {
        moduleCode: mod.code,
        moduleName: mod.name,
        moduleType: mod.moduleType,
        sortOrder: mod.sortOrder,
        icon: mod.icon ?? null,
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

  const modulesByCode = new Map(
    (await prisma.module.findMany()).map((m) => [m.moduleCode, m]),
  );

  for (const perm of PLATFORM_OWNER_PERMISSION_CODES) {
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
        createdBy,
      },
    });
  } else {
    role = await tx.role.update({
      where: { roleId: role.roleId },
      data: {
        roleName: account.roleName,
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

  for (const [moduleCode, actions] of Object.entries(account.modulePermissions)) {
    for (const action of actions) {
      permissionCodes.add(`${moduleCode}:${action}`);
    }
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
  const existing = await tx.userRole.findUnique({
    where: {
      userId_companyId_roleId: { userId, companyId, roleId },
    },
  });

  if (!existing) {
    // Deactivate other roles for this user in company (primary role only)
    await tx.userRole.updateMany({
      where: { userId, companyId, isActive: true },
      data: { isActive: false },
    });
    await tx.userRole.create({
      data: {
        userId,
        companyId,
        roleId,
        assignedBy,
        isActive: true,
      },
    });
  } else {
    await tx.userRole.updateMany({
      where: { userId, companyId, isActive: true, NOT: { roleId } },
      data: { isActive: false },
    });
    await tx.userRole.update({
      where: { userRoleId: existing.userRoleId },
      data: { isActive: true },
    });
  }
}

async function ensureModuleAccessOverrides(tx, userId, companyId, account, modulesByCode, createdBy) {
  await tx.userModuleAccess.deleteMany({ where: { userId, companyId } });

  if (!account.denyOtherModules) return;

  const allowed = new Set(Object.keys(account.modulePermissions));
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

async function main() {
  console.log('Seeding client login sample accounts...\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in .env');
  }

  const modulesByCode = await ensureModules();
  console.log('Modules + permissions ready.\n');

  const results = [];
  for (const account of ACCOUNTS) {
    const row = await seedAccount(account, modulesByCode);
    results.push(row);
    console.log(
      `✓ ${row.companyCode.padEnd(10)} / ${row.employeeCode.padEnd(10)} / ${row.password.padEnd(12)}  (${row.roleCode})`,
    );
  }

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
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
