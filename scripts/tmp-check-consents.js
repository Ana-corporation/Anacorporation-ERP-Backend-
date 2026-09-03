require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('./apply-gcp-sql-env');

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing. Create a .env file with your PostgreSQL connection string.');
  }

  const consentCount = await prisma.userConsent.count();
  const latestUser = await prisma.user.findFirst({
    orderBy: { userId: 'desc' },
    select: { userId: true },
  });

  console.log(JSON.stringify({ consentCount, latestUserId: latestUser?.userId?.toString() ?? null }));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
