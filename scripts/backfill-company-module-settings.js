/**
 * Ensures company_modules rows exist (isEnabled=true) for entitled plan modules.
 * Run after subscription entitlement migration for existing tenants.
 *
 * Usage: node scripts/backfill-company-module-settings.js
 */
const { PrismaClient } = require('@prisma/client');

const LIVE_STATUSES = ['active', 'trial'];
const TENANT_LIFECYCLES = ['AVAILABLE', 'DEPRECATED'];

async function main() {
  const prisma = new PrismaClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const subs = await prisma.companySubscription.findMany({
    where: {
      deletedAt: null,
      status: { in: LIVE_STATUSES },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
    },
    select: {
      companyId: true,
      planId: true,
    },
    distinct: ['companyId'],
  });

  let upserted = 0;

  for (const sub of subs) {
    const planModules = await prisma.planModule.findMany({
      where: { planId: sub.planId },
      select: { moduleId: true },
    });

    const overrides = await prisma.companyModuleOverride.findMany({
      where: {
        companyId: sub.companyId,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gte: today } }],
      },
      include: {
        module: { select: { lifecycleStatus: true, moduleType: true, deletedAt: true } },
      },
    });

    const entitled = new Set(planModules.map((pm) => pm.moduleId.toString()));

    for (const row of overrides) {
      if (row.module.deletedAt || row.module.moduleType !== 'product') continue;
      if (!TENANT_LIFECYCLES.includes(row.module.lifecycleStatus)) continue;
      const key = row.moduleId.toString();
      if (row.action === 'GRANT') entitled.add(key);
      if (row.action === 'REVOKE') entitled.delete(key);
    }

    for (const moduleIdStr of entitled) {
      const moduleId = BigInt(moduleIdStr);
      const mod = await prisma.module.findFirst({
        where: {
          moduleId,
          moduleType: 'product',
          deletedAt: null,
          lifecycleStatus: { in: TENANT_LIFECYCLES },
        },
      });
      if (!mod) continue;

      const existing = await prisma.companyModule.findUnique({
        where: {
          companyId_moduleId: { companyId: sub.companyId, moduleId },
        },
      });

      if (!existing || existing.deletedAt) {
        await prisma.companyModule.upsert({
          where: {
            companyId_moduleId: { companyId: sub.companyId, moduleId },
          },
          create: {
            companyId: sub.companyId,
            moduleId,
            isEnabled: true,
            isActive: true,
          },
          update: {
            isEnabled: true,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
          },
        });
        upserted += 1;
      } else if (existing.isEnabled === false && existing.isActive === false) {
        // Leave admin-disabled modules unchanged
      }
    }
  }

  console.log(`Backfill complete: ${upserted} company_modules row(s) created/updated`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
