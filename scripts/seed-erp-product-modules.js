/**
 * BE-4: Seed admin + product ERP modules and Phase 1 permissions.
 * Run after migration: node scripts/seed-erp-product-modules.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PHASE1_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'];

const ADMIN_MODULES = [
  { code: 'shared', name: 'Shared Master Data', moduleType: 'admin', sortOrder: 1 },
  { code: 'organization', name: 'Organization', moduleType: 'admin', sortOrder: 2 },
  { code: 'iam', name: 'Identity & Access', moduleType: 'admin', sortOrder: 3 },
  { code: 'subscription', name: 'Subscription & Billing', moduleType: 'admin', sortOrder: 4 },
  { code: 'platform', name: 'Platform', moduleType: 'admin', sortOrder: 5 },
];

const PRODUCT_MODULES = [
  { code: 'financials', name: 'Financials', moduleType: 'product', sortOrder: 10, icon: 'finance' },
  { code: 'supply-chain', name: 'Supply Chain', moduleType: 'product', sortOrder: 11, icon: 'supply' },
  { code: 'hcm', name: 'HCM', moduleType: 'product', sortOrder: 12, icon: 'people' },
  { code: 'manufacturing', name: 'Manufacturing', moduleType: 'product', sortOrder: 13, icon: 'factory' },
  { code: 'crm', name: 'CRM', moduleType: 'product', sortOrder: 14, icon: 'crm' },
  { code: 'projects', name: 'Projects', moduleType: 'product', sortOrder: 15, icon: 'projects' },
];

const ALL_MODULES = [...ADMIN_MODULES, ...PRODUCT_MODULES];

async function seedModules() {
  for (const mod of ALL_MODULES) {
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
    console.log(`  module: ${mod.code} (${mod.moduleType})`);
  }
}

async function seedProductPermissions() {
  const modules = await prisma.module.findMany({
    where: { moduleCode: { in: PRODUCT_MODULES.map((m) => m.code) } },
  });
  const byCode = new Map(modules.map((m) => [m.moduleCode, m]));

  for (const mod of PRODUCT_MODULES) {
    const row = byCode.get(mod.code);
    if (!row) {
      console.warn(`  skip permissions — module not found: ${mod.code}`);
      continue;
    }
    for (const action of PHASE1_ACTIONS) {
      const permissionCode = `${mod.code}:${action}`;
      await prisma.permission.upsert({
        where: {
          moduleId_permissionCode: {
            moduleId: row.moduleId,
            permissionCode,
          },
        },
        update: { action, permissionName: `${mod.name} — ${action}` },
        create: {
          moduleId: row.moduleId,
          permissionCode,
          permissionName: `${mod.name} — ${action}`,
          action,
        },
      });
    }
    console.log(`  permissions: ${mod.code} (${PHASE1_ACTIONS.length} actions)`);
  }
}

async function main() {
  console.log('Seeding ERP modules (admin + product)...');
  await seedModules();
  console.log('Seeding product module permissions (Phase 1 actions)...');
  await seedProductPermissions();
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
