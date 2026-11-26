/**
 * Create Ana store in-charge login: J.Pandiya Selvi
 *   companyCode:  ANA_MACHINERY_P_LTD
 *   employeeCode: ANASTORE
 *   password:     Selvi@ana20
 *
 * Usage:
 *   node scripts/with-node-env.js production node scripts/create-ana-store-incharge.js
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const ACCOUNT = {
  companyId: 28n,
  employeeCode: 'ANASTORE',
  password: 'Selvi@ana20',
  username: 'pandiya.selvi',
  email: 'pandiya.selvi@anamachinery.com',
  firstName: 'Pandiya',
  lastName: 'Selvi',
  displayName: 'J.Pandiya Selvi',
  roleCode: 'STORE_INCHARGE',
  roleName: 'Store In-Charge',
};

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];
const INVENTORY_RESOURCES = [
  'vendors',
  'items',
  'inventory_stock',
  'opening_stock',
  'material_issues',
  'stock_adjustments',
  'stock_transfers',
];

function inventoryPermissionCodes() {
  const codes = new Set();
  for (const resource of INVENTORY_RESOURCES) {
    for (const action of ACTIONS) codes.add(`${resource}:${action}`);
  }
  // Bins / stores / locations
  for (const action of ['view', 'create', 'edit', 'delete']) {
    codes.add(`warehouses:${action}`);
  }
  codes.add('branches:view');
  return [...codes];
}

async function ensurePermissionRows(codes) {
  const modules = await prisma.module.findMany({
    where: { moduleCode: { in: ['supply-chain', 'organization'] } },
  });
  const byCode = new Map(modules.map((m) => [m.moduleCode, m]));
  const supply = byCode.get('supply-chain');
  const org = byCode.get('organization');
  if (!supply || !org) {
    throw new Error('Modules supply-chain / organization missing — run permission seed / login as admin first');
  }

  for (const code of codes) {
    const moduleId = code.startsWith('warehouses:') || code.startsWith('branches:') ? org.moduleId : supply.moduleId;
    const action = code.split(':')[1] || 'view';
    await prisma.permission.upsert({
      where: { moduleId_permissionCode: { moduleId, permissionCode: code } },
      update: { permissionName: code },
      create: {
        moduleId,
        permissionCode: code,
        permissionName: code,
        action,
      },
    });
  }
}

async function main() {
  const company = await prisma.company.findFirst({
    where: { companyId: ACCOUNT.companyId, deletedAt: null },
    select: { companyId: true, companyCode: true, name: true },
  });
  if (!company) throw new Error('Ana company 28 not found');

  const permissionCodes = inventoryPermissionCodes();
  await ensurePermissionRows(permissionCodes);

  const passwordHash = await bcrypt.hash(ACCOUNT.password, 12);
  const admin = await prisma.userCompany.findFirst({
    where: { companyId: company.companyId, status: 'active', deletedAt: null },
    select: { userId: true },
    orderBy: { userCompanyId: 'asc' },
  });
  const createdBy = admin?.userId ?? null;

  const result = await prisma.$transaction(async (tx) => {
    let user = await tx.user.findFirst({
      where: {
        OR: [{ email: ACCOUNT.email }, { username: ACCOUNT.username }],
        deletedAt: null,
      },
    });
    if (!user) {
      user = await tx.user.create({
        data: {
          username: ACCOUNT.username,
          email: ACCOUNT.email,
          firstName: ACCOUNT.firstName,
          lastName: ACCOUNT.lastName,
          displayName: ACCOUNT.displayName,
          isActive: true,
          isLocked: false,
        },
      });
    } else {
      user = await tx.user.update({
        where: { userId: user.userId },
        data: {
          username: ACCOUNT.username,
          email: ACCOUNT.email,
          firstName: ACCOUNT.firstName,
          lastName: ACCOUNT.lastName,
          displayName: ACCOUNT.displayName,
          isActive: true,
          isLocked: false,
          deletedAt: null,
        },
      });
    }

    const auth = await tx.userAuthentication.findUnique({ where: { userId: user.userId } });
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

    let role = await tx.role.findFirst({
      where: { companyId: company.companyId, roleCode: ACCOUNT.roleCode, deletedAt: null },
    });
    if (!role) {
      role = await tx.role.create({
        data: {
          companyId: company.companyId,
          roleCode: ACCOUNT.roleCode,
          roleName: ACCOUNT.roleName,
          isSystem: false,
          roleType: 'CUSTOM',
          createdBy,
        },
      });
    } else {
      role = await tx.role.update({
        where: { roleId: role.roleId },
        data: { roleName: ACCOUNT.roleName, deletedAt: null, updatedAt: new Date() },
      });
    }

    await tx.rolePermission.deleteMany({ where: { roleId: role.roleId } });
    const permissions = await tx.permission.findMany({
      where: { permissionCode: { in: permissionCodes } },
    });
    if (permissions.length === 0) {
      throw new Error('No inventory permissions found in DB after upsert');
    }
    await tx.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: role.roleId,
        moduleId: permission.moduleId,
        permissionId: permission.permissionId,
        isAllowed: true,
        createdBy,
      })),
      skipDuplicates: true,
    });

    // Clear employeeId collisions
    await tx.userCompany.updateMany({
      where: {
        companyId: company.companyId,
        employeeId: ACCOUNT.employeeCode,
        NOT: { userId: user.userId },
      },
      data: { employeeId: null },
    });

    const membership = await tx.userCompany.findUnique({
      where: { userId_companyId: { userId: user.userId, companyId: company.companyId } },
    });
    if (!membership) {
      await tx.userCompany.create({
        data: {
          userId: user.userId,
          companyId: company.companyId,
          employeeId: ACCOUNT.employeeCode,
          status: 'active',
          isDefault: true,
          createdBy,
        },
      });
    } else {
      await tx.userCompany.update({
        where: { userCompanyId: membership.userCompanyId },
        data: {
          employeeId: ACCOUNT.employeeCode,
          status: 'active',
          isDefault: true,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
    }

    const existingRole = await tx.userRole.findFirst({
      where: {
        userId: user.userId,
        companyId: company.companyId,
        roleId: role.roleId,
      },
    });
    if (!existingRole) {
      await tx.userRole.create({
        data: {
          userId: user.userId,
          companyId: company.companyId,
          roleId: role.roleId,
          isActive: true,
          assignedBy: createdBy,
        },
      });
    } else {
      await tx.userRole.update({
        where: { userRoleId: existingRole.userRoleId },
        data: { isActive: true, endedAt: null, endReason: null },
      });
    }

    // End other active roles for this user in company (single role assignment)
    await tx.userRole.updateMany({
      where: {
        userId: user.userId,
        companyId: company.companyId,
        isActive: true,
        endedAt: null,
        NOT: { roleId: role.roleId },
      },
      data: { isActive: false, endedAt: new Date(), endReason: 'REASSIGNED' },
    });

    return {
      userId: user.userId.toString(),
      roleId: role.roleId.toString(),
      permissionsAttached: permissions.length,
      permissionCodesRequested: permissionCodes.length,
    };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        name: ACCOUNT.displayName,
        erpRole: ACCOUNT.roleName,
        companyCode: company.companyCode,
        companyName: company.name,
        employeeCode: ACCOUNT.employeeCode,
        password: ACCOUNT.password,
        email: ACCOUNT.email,
        username: ACCOUNT.username,
        login: {
          companyCode: company.companyCode,
          employeeCode: ACCOUNT.employeeCode,
          password: ACCOUNT.password,
        },
        ...result,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    try {
      require('fs').unlinkSync(require('path').join(__dirname, 'tmp-inspect-ana-roles.js'));
    } catch {
      /* ignore */
    }
  });
