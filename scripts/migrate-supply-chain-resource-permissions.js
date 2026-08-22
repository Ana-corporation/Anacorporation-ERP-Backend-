/**
 * Migrate role_permissions: expand legacy supply-chain:{action}
 * into vendors:{action} + items:{action} (does not remove legacy codes).
 *
 * Run after permissions catalogue includes vendors:* and items:*:
 *   node scripts/seed-erp-product-modules.js
 *   node scripts/migrate-supply-chain-resource-permissions.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];

async function main() {
  const supplyChain = await prisma.module.findUnique({
    where: { moduleCode: 'supply-chain' },
  });
  if (!supplyChain) {
    throw new Error('Module supply-chain not found — seed modules first');
  }

  const resourcePerms = await prisma.permission.findMany({
    where: {
      moduleId: supplyChain.moduleId,
      permissionCode: {
        in: ACTIONS.flatMap((a) => [`vendors:${a}`, `items:${a}`]),
      },
    },
  });
  const byCode = new Map(resourcePerms.map((p) => [p.permissionCode, p]));
  if (byCode.size < ACTIONS.length * 2) {
    throw new Error(
      'Missing vendors:* / items:* permissions — run seed-erp-product-modules.js first',
    );
  }

  const legacyPerms = await prisma.permission.findMany({
    where: {
      moduleId: supplyChain.moduleId,
      permissionCode: { in: ACTIONS.map((a) => `supply-chain:${a}`) },
    },
  });
  const legacyById = new Map(legacyPerms.map((p) => [p.permissionId.toString(), p]));

  const rolePerms = await prisma.rolePermission.findMany({
    where: { permissionId: { in: legacyPerms.map((p) => p.permissionId) } },
  });

  let inserted = 0;
  for (const rp of rolePerms) {
    const legacy = legacyById.get(rp.permissionId.toString());
    if (!legacy) continue;
    const action = legacy.permissionCode.split(':')[1];
    for (const resource of ['vendors', 'items']) {
      const target = byCode.get(`${resource}:${action}`);
      if (!target) continue;
      try {
        await prisma.rolePermission.create({
          data: {
            roleId: rp.roleId,
            moduleId: target.moduleId,
            permissionId: target.permissionId,
            isAllowed: rp.isAllowed,
            createdBy: rp.createdBy,
          },
        });
        inserted += 1;
      } catch (err) {
        // unique violation — already migrated
        if (err?.code !== 'P2002') throw err;
      }
    }
  }

  console.log(
    `Migrated ${rolePerms.length} legacy supply-chain role_permission row(s); inserted ${inserted} resource grant(s).`,
  );
  console.log(
    'Legacy supply-chain:* codes retained. Remove after verifying FE + API use vendors:*/items:*.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
