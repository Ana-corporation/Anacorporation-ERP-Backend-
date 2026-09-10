/**
 * Sync Company Admin setup + product workspace permissions onto all ADMIN roles:
 *   - org structure (branches/departments/designations/warehouses) × 16
 *   - roles:* × 4
 *   - users:* × 4
 *   - company_modules:view|edit × 2
 *   - supply-chain vendors:* + items:* (login modules[] / API guards)
 *   - product module:action Phase-1 for each PRODUCT_MODULES entry
 *
 *   npm run seed:org-permissions
 *   node scripts/sync-org-structure-permissions.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('./apply-gcp-sql-env');

const { PrismaClient } = require('@prisma/client');

const PHASE1_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];

const PRODUCT_MODULES = [
  { code: 'financials', name: 'Financials' },
  { code: 'supply-chain', name: 'Supply Chain' },
  { code: 'hcm', name: 'HCM' },
  { code: 'manufacturing', name: 'Manufacturing' },
  { code: 'crm', name: 'CRM' },
  { code: 'projects', name: 'Projects' },
];

const ADMIN_SETUP_PERMISSIONS = [
  { moduleCode: 'organization', code: 'branches:view', name: 'View Branches', action: 'view' },
  { moduleCode: 'organization', code: 'branches:create', name: 'Create Branches', action: 'create' },
  { moduleCode: 'organization', code: 'branches:edit', name: 'Edit Branches', action: 'edit' },
  { moduleCode: 'organization', code: 'branches:delete', name: 'Delete Branches', action: 'delete' },
  { moduleCode: 'organization', code: 'departments:view', name: 'View Departments', action: 'view' },
  { moduleCode: 'organization', code: 'departments:create', name: 'Create Departments', action: 'create' },
  { moduleCode: 'organization', code: 'departments:edit', name: 'Edit Departments', action: 'edit' },
  { moduleCode: 'organization', code: 'departments:delete', name: 'Delete Departments', action: 'delete' },
  { moduleCode: 'organization', code: 'designations:view', name: 'View Designations', action: 'view' },
  { moduleCode: 'organization', code: 'designations:create', name: 'Create Designations', action: 'create' },
  { moduleCode: 'organization', code: 'designations:edit', name: 'Edit Designations', action: 'edit' },
  { moduleCode: 'organization', code: 'designations:delete', name: 'Delete Designations', action: 'delete' },
  { moduleCode: 'organization', code: 'warehouses:view', name: 'View Warehouses', action: 'view' },
  { moduleCode: 'organization', code: 'warehouses:create', name: 'Create Warehouses', action: 'create' },
  { moduleCode: 'organization', code: 'warehouses:edit', name: 'Edit Warehouses', action: 'edit' },
  { moduleCode: 'organization', code: 'warehouses:delete', name: 'Delete Warehouses', action: 'delete' },
  { moduleCode: 'iam', code: 'roles:view', name: 'View Roles', action: 'view' },
  { moduleCode: 'iam', code: 'roles:create', name: 'Create Roles', action: 'create' },
  { moduleCode: 'iam', code: 'roles:edit', name: 'Edit Roles', action: 'edit' },
  { moduleCode: 'iam', code: 'roles:delete', name: 'Delete Roles', action: 'delete' },
  { moduleCode: 'iam', code: 'users:view', name: 'View Users', action: 'view' },
  { moduleCode: 'iam', code: 'users:create', name: 'Create Users', action: 'create' },
  { moduleCode: 'iam', code: 'users:edit', name: 'Edit Users', action: 'edit' },
  { moduleCode: 'iam', code: 'users:delete', name: 'Delete Users', action: 'delete' },
  { moduleCode: 'subscription', code: 'company_modules:view', name: 'View Company Modules', action: 'view' },
  { moduleCode: 'subscription', code: 'company_modules:edit', name: 'Edit Company Modules', action: 'edit' },
  ...PHASE1_ACTIONS.flatMap((action) => [
    {
      moduleCode: 'supply-chain',
      code: `vendors:${action}`,
      name: `Vendors — ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
      action,
    },
    {
      moduleCode: 'supply-chain',
      code: `items:${action}`,
      name: `Items — ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
      action,
    },
  ]),
  ...PRODUCT_MODULES.flatMap((mod) =>
    PHASE1_ACTIONS.map((action) => ({
      moduleCode: mod.code,
      code: `${mod.code}:${action}`,
      name: `${mod.name} — ${action.charAt(0).toUpperCase()}${action.slice(1)}`,
      action,
    })),
  ),
];

async function main() {
  const prisma = new PrismaClient();

  const permissionIds = [];
  for (const def of ADMIN_SETUP_PERMISSIONS) {
    const mod = await prisma.module.findFirst({ where: { moduleCode: def.moduleCode } });
    if (!mod) {
      console.warn(`skip — module not found: ${def.moduleCode} (${def.code})`);
      continue;
    }

    const permission = await prisma.permission.upsert({
      where: {
        moduleId_permissionCode: {
          moduleId: mod.moduleId,
          permissionCode: def.code,
        },
      },
      update: { permissionName: def.name, action: def.action },
      create: {
        moduleId: mod.moduleId,
        permissionCode: def.code,
        permissionName: def.name,
        action: def.action,
      },
    });
    permissionIds.push(permission.permissionId);
  }

  const adminRoles = await prisma.role.findMany({
    where: { roleCode: 'ADMIN', deletedAt: null },
  });

  for (const role of adminRoles) {
    for (const permissionId of permissionIds) {
      const permission = await prisma.permission.findUnique({ where: { permissionId } });
      if (!permission) continue;

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.roleId, permissionId } },
        update: { isAllowed: true },
        create: {
          roleId: role.roleId,
          moduleId: permission.moduleId,
          permissionId,
          isAllowed: true,
        },
      });
    }
  }

  console.log(
    `Synced ${permissionIds.length} ADMIN setup+product permissions to ${adminRoles.length} ADMIN role(s)`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
