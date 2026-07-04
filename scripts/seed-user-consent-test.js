const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const userId = BigInt(process.argv[2] || '12');
  const companyId = BigInt(process.argv[3] || '12');

  const record = await prisma.userConsent.create({
    data: {
      userId,
      companyId,
      consentType: 'privacy_policy',
      consentVersion: 'v2.1',
      isAccepted: true,
      acceptedDate: new Date(),
      ipAddress: '192.168.1.10',
    },
  });

  console.log(
    JSON.stringify(
      {
        consentId: record.consentId.toString(),
        userId: record.userId.toString(),
        companyId: record.companyId?.toString(),
        consentType: record.consentType,
        consentVersion: record.consentVersion,
        isAccepted: record.isAccepted,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
