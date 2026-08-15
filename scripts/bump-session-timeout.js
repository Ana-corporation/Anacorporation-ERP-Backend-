const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.companySecurityPolicy.updateMany({
    data: { sessionTimeoutMin: 480 },
  });
  console.log('updated_policies', result.count);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
