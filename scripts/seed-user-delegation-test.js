require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const memberships = await prisma.userCompany.findMany({
    where: { deletedAt: null, status: 'active' },
    select: { userId: true, companyId: true },
    orderBy: { companyId: 'asc' },
  });

  const byCompany = new Map();
  for (const membership of memberships) {
    const key = membership.companyId.toString();
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(membership.userId.toString());
  }

  let userId;
  let delegateUserId;
  let companyId;

  for (const [company, users] of byCompany.entries()) {
    if (users.length >= 2) {
      companyId = company;
      userId = users[0];
      delegateUserId = users[1];
      break;
    }
  }

  if (!userId) {
    throw new Error('Need at least two active users in the same company to seed a delegation');
  }

  const record = await prisma.userDelegation.create({
    data: {
      userId: BigInt(userId),
      delegateUserId: BigInt(delegateUserId),
      companyId: BigInt(companyId),
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-31'),
      reason: 'Annual leave coverage',
      status: 'active',
      createdBy: BigInt(userId),
    },
  });

  console.log(
    JSON.stringify(
      {
        delegationId: record.delegationId.toString(),
        userId: record.userId.toString(),
        delegateUserId: record.delegateUserId.toString(),
        companyId: record.companyId.toString(),
        startDate: record.startDate.toISOString().slice(0, 10),
        endDate: record.endDate?.toISOString().slice(0, 10) ?? null,
        status: record.status,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
