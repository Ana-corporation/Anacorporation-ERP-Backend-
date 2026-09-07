/**
 * Seed subscription plans + plan_modules for SaaS entitlement testing.
 * Usage: node scripts/seed-subscription-plans.js
 */
const { PrismaClient } = require('@prisma/client');

const PLANS = [
  {
    planCode: 'STARTER',
    name: 'Starter',
    description: 'Single product module entry plan',
    billingCycle: 'monthly',
    price: 0,
    modules: ['supply-chain'],
  },
  {
    planCode: 'PROFESSIONAL',
    name: 'Professional',
    description: 'Core operational modules',
    billingCycle: 'yearly',
    price: 0,
    modules: ['supply-chain', 'crm'],
  },
  {
    planCode: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Full product suite',
    billingCycle: 'yearly',
    price: 0,
    modules: ['supply-chain', 'crm'],
  },
];

async function main() {
  const prisma = new PrismaClient();

  for (const planDef of PLANS) {
    const plan = await prisma.subscriptionPlan.upsert({
      where: { planCode: planDef.planCode },
      create: {
        planCode: planDef.planCode,
        name: planDef.name,
        description: planDef.description,
        billingCycle: planDef.billingCycle,
        price: planDef.price,
        isActive: true,
      },
      update: {
        name: planDef.name,
        description: planDef.description,
        billingCycle: planDef.billingCycle,
        isActive: true,
      },
    });

    const modules = await prisma.module.findMany({
      where: {
        moduleCode: { in: planDef.modules },
        deletedAt: null,
        moduleType: 'product',
      },
    });

    await prisma.planModule.deleteMany({ where: { planId: plan.planId } });

    for (const mod of modules) {
      await prisma.planModule.create({
        data: { planId: plan.planId, moduleId: mod.moduleId },
      });
    }

    console.log(`Plan ${plan.planCode}: ${modules.map((m) => m.moduleCode).join(', ') || '(no modules found)'}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
