/**
 * Seed subscription plans + FREE = all existing product modules.
 * Usage: npm run seed:subscription-plans
 *
 * Rules:
 *  - Do NOT create dummy modules — only attach what already exists in catalogue.
 *  - FREE.plan_modules = every active product module (now + after re-seed when new ones exist).
 *  - Option A: set those modules AVAILABLE so login/entitlements surface them.
 *  - STARTER / PROFESSIONAL / ENTERPRISE stay isActive=false (not selling paid yet).
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const FIXED_PLANS = [
  {
    planCode: 'FREE',
    name: 'Free',
    description: 'All product modules included. No payment required.',
    billingCycle: 'monthly',
    price: 0,
    maxUsers: null,
    isActive: true,
    /** Attach every existing active product module (no hardcode list). */
    allProductModules: true,
  },
  {
    planCode: 'STARTER',
    name: 'Starter',
    description: 'Inactive — not for assign until paid plans launch',
    billingCycle: 'monthly',
    price: 0,
    isActive: false,
    modules: ['supply-chain'],
  },
  {
    planCode: 'PROFESSIONAL',
    name: 'Professional',
    description: 'Inactive — not for assign until paid plans launch',
    billingCycle: 'yearly',
    price: 0,
    isActive: false,
    modules: ['supply-chain'],
  },
  {
    planCode: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Inactive — not for assign until paid plans launch',
    billingCycle: 'yearly',
    price: 0,
    isActive: false,
    modules: ['supply-chain'],
  },
];

/**
 * Option A: existing product modules must be AVAILABLE for entitlements catalogue.
 * Does not insert new modules.
 */
async function ensureProductModulesAvailable(prisma) {
  const productModules = await prisma.module.findMany({
    where: { deletedAt: null, moduleType: 'product', isActive: true },
    select: { moduleId: true, moduleCode: true, lifecycleStatus: true },
    orderBy: { moduleCode: 'asc' },
  });

  for (const mod of productModules) {
    if (mod.lifecycleStatus !== 'AVAILABLE' && mod.lifecycleStatus !== 'DEPRECATED') {
      await prisma.module.update({
        where: { moduleId: mod.moduleId },
        data: { lifecycleStatus: 'AVAILABLE', updatedAt: new Date() },
      });
      console.log(`  Module ${mod.moduleCode}: ${mod.lifecycleStatus} → AVAILABLE`);
    }
  }

  return productModules;
}

async function resolveModules(prisma, planDef) {
  if (planDef.allProductModules) {
    return prisma.module.findMany({
      where: {
        deletedAt: null,
        moduleType: 'product',
        isActive: true,
      },
      orderBy: { moduleCode: 'asc' },
    });
  }

  return prisma.module.findMany({
    where: {
      moduleCode: { in: planDef.modules || [] },
      deletedAt: null,
      moduleType: 'product',
    },
  });
}

async function main() {
  const prisma = new PrismaClient();

  console.log('Ensuring existing product modules are AVAILABLE (no new modules created)…');
  await ensureProductModulesAvailable(prisma);

  for (const planDef of FIXED_PLANS) {
    const plan = await prisma.subscriptionPlan.upsert({
      where: { planCode: planDef.planCode },
      create: {
        planCode: planDef.planCode,
        name: planDef.name,
        description: planDef.description,
        billingCycle: planDef.billingCycle,
        price: planDef.price,
        maxUsers: planDef.maxUsers ?? undefined,
        isActive: planDef.isActive ?? true,
      },
      update: {
        name: planDef.name,
        description: planDef.description,
        billingCycle: planDef.billingCycle,
        price: planDef.price,
        maxUsers: planDef.maxUsers === null ? null : planDef.maxUsers ?? undefined,
        isActive: planDef.isActive ?? true,
      },
    });

    const modules = await resolveModules(prisma, planDef);

    await prisma.planModule.deleteMany({ where: { planId: plan.planId } });

    for (const mod of modules) {
      await prisma.planModule.create({
        data: { planId: plan.planId, moduleId: mod.moduleId },
      });
    }

    console.log(
      `Plan ${plan.planCode} (id=${plan.planId}, active=${plan.isActive}): ${
        modules.map((m) => m.moduleCode).join(', ') || '(no modules)'
      }`,
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
