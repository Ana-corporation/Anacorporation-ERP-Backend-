require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('./apply-gcp-sql-env');

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const userId = BigInt(process.argv[2] || '12');

  const record = await prisma.userDevice.create({
    data: {
      userId,
      deviceUuid: randomUUID(),
      deviceName: 'Work Laptop',
      manufacturer: 'Dell',
      model: 'Latitude 5540',
      os: 'Windows 11',
      browser: 'Chrome',
      lastSeen: new Date(),
      isTrusted: true,
      isBlocked: false,
    },
  });

  console.log(
    JSON.stringify(
      {
        deviceId: record.deviceId.toString(),
        userId: record.userId.toString(),
        deviceUuid: record.deviceUuid,
        deviceName: record.deviceName,
        isTrusted: record.isTrusted,
        isBlocked: record.isBlocked,
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
