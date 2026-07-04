const { PrismaClient } = require('@prisma/client');

const DEPARTMENT_PERMISSIONS = [
  { code: 'departments:view', name: 'View Departments', action: 'view' },
  { code: 'departments:create', name: 'Create Departments', action: 'create' },
  { code: 'departments:edit', name: 'Edit Departments', action: 'edit' },
  { code: 'departments:delete', name: 'Delete Departments', action: 'delete' },
];

async function main() {
  const prisma = new PrismaClient();

  const orgModule = await prisma.module.findFirst({ where: { moduleCode: 'organization' } });
  if (!orgModule) throw new Error('organization module not found');

  const permissionIds = [];
  for (const def of DEPARTMENT_PERMISSIONS) {
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

  console.log(`Synced department permissions to ${adminRoles.length} ADMIN roles`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
