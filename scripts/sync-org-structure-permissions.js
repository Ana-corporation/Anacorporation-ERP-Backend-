/**
 * Sync Organization structure permissions (branches/departments/designations/warehouses)
 * onto all ADMIN roles. Prefer: npm run seed:client-logins (includes this).
 *
 *   node scripts/sync-org-structure-permissions.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const ORG_STRUCTURE_PERMISSIONS = [
  { code: 'branches:view', name: 'View Branches', action: 'view' },
  { code: 'branches:create', name: 'Create Branches', action: 'create' },
  { code: 'branches:edit', name: 'Edit Branches', action: 'edit' },
  { code: 'branches:delete', name: 'Delete Branches', action: 'delete' },
  { code: 'departments:view', name: 'View Departments', action: 'view' },
  { code: 'departments:create', name: 'Create Departments', action: 'create' },
  { code: 'departments:edit', name: 'Edit Departments', action: 'edit' },
  { code: 'departments:delete', name: 'Delete Departments', action: 'delete' },
  { code: 'designations:view', name: 'View Designations', action: 'view' },
  { code: 'designations:create', name: 'Create Designations', action: 'create' },
  { code: 'designations:edit', name: 'Edit Designations', action: 'edit' },
  { code: 'designations:delete', name: 'Delete Designations', action: 'delete' },
  { code: 'warehouses:view', name: 'View Warehouses', action: 'view' },
  { code: 'warehouses:create', name: 'Create Warehouses', action: 'create' },
  { code: 'warehouses:edit', name: 'Edit Warehouses', action: 'edit' },
  { code: 'warehouses:delete', name: 'Delete Warehouses', action: 'delete' },
];

async function main() {
  const prisma = new PrismaClient();

  const orgModule = await prisma.module.findFirst({ where: { moduleCode: 'organization' } });
  if (!orgModule) throw new Error('organization module not found');

  const permissionIds = [];
  for (const def of ORG_STRUCTURE_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: {
        moduleId_permissionCode: {
          moduleId: orgModule.moduleId,
          permissionCode: def.code,
        },
      },
      update: { permissionName: def.name, action: def.action },
      create: {
        moduleId: orgModule.moduleId,
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
    `Synced ${ORG_STRUCTURE_PERMISSIONS.length} org structure permissions to ${adminRoles.length} ADMIN role(s)`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
