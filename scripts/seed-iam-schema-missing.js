require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const companyId = BigInt(process.argv[2] || '2');
  const userId = BigInt(process.argv[3] || '2');

  const plan = await prisma.subscriptionPlan.findFirst({ where: { deletedAt: null } });
  const erpModule = await prisma.module.findFirst({ where: { deletedAt: null } });
  if (!plan || !erpModule) throw new Error('Need at least one plan and module in DB');

  const branch = await prisma.branch.create({
    data: {
      companyId,
      branchCode: `BR-${Date.now().toString().slice(-6)}`,
      name: 'Main Branch',
      city: 'Mumbai',
      country: 'India',
      isActive: true,
      createdBy: userId,
    },
  });

  const warehouse = await prisma.warehouse.create({
    data: {
      companyId,
      branchId: branch.branchId,
      warehouseCode: `WH-${Date.now().toString().slice(-6)}`,
      name: 'Central Warehouse',
      isActive: true,
      createdBy: userId,
    },
  });

  const subscription = await prisma.companySubscription.create({
    data: {
      companyId,
      planId: plan.planId,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2027-01-01'),
      amount: 99.99,
      status: 'active',
      createdBy: userId,
    },
  });

  const companyModule = await prisma.companyModule.upsert({
    where: {
      companyId_moduleId: { companyId, moduleId: erpModule.moduleId },
    },
    update: { isActive: true },
    create: {
      companyId,
      moduleId: erpModule.moduleId,
      isActive: true,
      createdBy: userId,
    },
  });

  const policy = await prisma.companySecurityPolicy.upsert({
    where: { companyId },
    update: { minPasswordLength: 10 },
    create: {
      companyId,
      minPasswordLength: 10,
      requireMfa: false,
      createdBy: userId,
    },
  });

  const mfa = await prisma.userMfa.create({
    data: {
      userId,
      mfaType: 'totp',
      isPrimary: true,
      isEnabled: true,
    },
  });

  const moduleAccess = await prisma.userModuleAccess.upsert({
    where: {
      userId_companyId_moduleId: { userId, companyId, moduleId: erpModule.moduleId },
    },
    update: { accessType: 'grant' },
    create: {
      userId,
      companyId,
      moduleId: erpModule.moduleId,
      accessType: 'grant',
      createdBy: userId,
    },
  });

  const preferences = await prisma.userPreference.upsert({
    where: { userId_companyId: { userId, companyId } },
    update: { theme: 'light' },
    create: { userId, companyId, theme: 'light', language: 'en' },
  });

  const device = await prisma.userDevice.create({
    data: {
      userId,
      deviceUuid: randomUUID(),
      deviceName: 'Seed Device',
      os: 'Windows 11',
      isTrusted: true,
    },
  });

  const session = await prisma.userSession.create({
    data: {
      userId,
      companyId,
      deviceId: device.deviceId,
      sessionStatus: 'active',
      browser: 'Chrome',
      ipAddress: '127.0.0.1',
    },
  });

  const loginHistory = await prisma.userLoginHistory.create({
    data: {
      userId,
      companyId,
      loginResult: 'success',
      ipAddress: '127.0.0.1',
      browser: 'Chrome',
    },
  });

  const notifications = await prisma.userNotification.upsert({
    where: { userId },
    update: { emailEnabled: true },
    create: { userId, emailEnabled: true, pushEnabled: true },
  });

  const signature = await prisma.userSignature.create({
    data: {
      userId,
      companyId,
      signatureType: 'approval',
      imagePath: `companies/${companyId}/signatures/approval.png`,
      isDefault: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        branchId: branch.branchId.toString(),
        warehouseId: warehouse.warehouseId.toString(),
        companySubscriptionId: subscription.companySubscriptionId.toString(),
        companyModuleId: companyModule.companyModuleId.toString(),
        policyId: policy.policyId.toString(),
        userMfaId: mfa.userMfaId.toString(),
        userModuleAccessId: moduleAccess.userModuleAccessId.toString(),
        preferenceId: preferences.preferenceId.toString(),
        sessionId: session.sessionId.toString(),
        loginHistoryId: loginHistory.loginHistoryId.toString(),
        notificationId: notifications.notificationId.toString(),
        signatureId: signature.signatureId.toString(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
