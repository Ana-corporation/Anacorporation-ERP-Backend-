/**
 * Phase 1 login test data: company + admin user + trial subscription + CRM/supply-chain modules.
 * Run after: npx prisma migrate deploy && npm run seed:erp-modules
 *
 *   node scripts/seed-phase1-login-user.js
 *
 * Login:
 *   POST /api/v1/auth/login
 *   { "employeeCode": "EMP-00001", "password": "TestPass1!", "companyCode": "DEMO_ACME" }
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const DEMO = {
  email: 'admin@demo-acme.com',
  password: 'TestPass1!',
  firstName: 'Demo',
  lastName: 'Admin',
  companyName: 'Demo Acme Corp',
  companyCode: 'DEMO_ACME',
  employeeCode: 'EMP-00001',
  planCode: 'DEMO_STARTER',
};

const PRODUCT_MODULE_CODES = [
  'financials',
  'supply-chain',
  'hcm',
  'manufacturing',
  'crm',
  'projects',
];

async function main() {
  const existing = await prisma.userCompany.findFirst({
    where: { employeeId: DEMO.employeeCode, company: { companyCode: DEMO.companyCode } },
    include: { company: true, user: true },
  });

  if (existing) {
    console.log('Demo user already exists.');
    console.log(`  companyCode:   ${DEMO.companyCode}`);
    console.log(`  companyId:     ${existing.companyId.toString()}`);
    console.log(`  employeeCode:  ${DEMO.employeeCode}`);
    console.log(`  password:      ${DEMO.password}`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO.password, 12);
  const modules = await prisma.module.findMany({
    where: { moduleCode: { in: PRODUCT_MODULE_CODES } },
  });
  const permissions = await prisma.permission.findMany({
    where: { moduleId: { in: modules.map((m) => m.moduleId) } },
  });

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: 'demo.admin',
        email: DEMO.email,
        firstName: DEMO.firstName,
        lastName: DEMO.lastName,
        displayName: `${DEMO.firstName} ${DEMO.lastName}`,
      },
    });

    await tx.userAuthentication.create({
      data: { userId: user.userId, passwordHash, isEmailVerified: true },
    });

    const company = await tx.company.create({
      data: {
        companyCode: DEMO.companyCode,
        name: DEMO.companyName,
        status: 'trial',
      },
    });

    const role = await tx.role.create({
      data: {
        companyId: company.companyId,
        roleCode: 'ADMIN',
        roleName: 'Administrator',
        isSystem: true,
        createdBy: user.userId,
      },
    });

    for (const permission of permissions) {
      await tx.rolePermission.create({
        data: {
          roleId: role.roleId,
          moduleId: permission.moduleId,
          permissionId: permission.permissionId,
          isAllowed: true,
          createdBy: user.userId,
        },
      });
    }

    await tx.userCompany.create({
      data: {
        userId: user.userId,
        companyId: company.companyId,
        employeeId: DEMO.employeeCode,
        status: 'active',
        isDefault: true,
        createdBy: user.userId,
      },
    });

    await tx.userRole.create({
      data: {
        userId: user.userId,
        companyId: company.companyId,
        roleId: role.roleId,
        assignedBy: user.userId,
      },
    });

    let plan = await tx.subscriptionPlan.findUnique({ where: { planCode: DEMO.planCode } });
    if (!plan) {
      plan = await tx.subscriptionPlan.create({
        data: {
          planCode: DEMO.planCode,
          name: 'Demo Starter',
          description: 'Phase 1 demo plan',
          price: 0,
          billingCycle: 'monthly',
          isActive: true,
        },
      });

      for (const mod of modules) {
        await tx.planModule.create({
          data: { planId: plan.planId, moduleId: mod.moduleId },
        });
      }
    }

    const today = new Date();
    const end = new Date(today);
    end.setFullYear(end.getFullYear() + 1);

    await tx.companySubscription.create({
      data: {
        companyId: company.companyId,
        planId: plan.planId,
        startDate: today,
        endDate: end,
        status: 'trial',
        amount: 0,
        createdBy: user.userId,
      },
    });

    return { user, company };
  });

  console.log('Demo login user created.');
  console.log(`  companyCode:   ${DEMO.companyCode}`);
  console.log(`  companyId:     ${result.company.companyId.toString()}`);
  console.log(`  employeeCode:  ${DEMO.employeeCode}`);
  console.log(`  password:      ${DEMO.password}`);
  console.log(`  email:         ${DEMO.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
