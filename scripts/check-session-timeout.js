const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.companySecurityPolicy.findMany({
    select: { companyId: true, sessionTimeoutMin: true },
  });
  for (const r of rows) {
    console.log(`${r.companyId.toString()} => ${r.sessionTimeoutMin} min`);
  }
  const bumped = await prisma.companySecurityPolicy.updateMany({
    where: { sessionTimeoutMin: { lt: 480 } },
    data: { sessionTimeoutMin: 480 },
  });
  console.log('bumped_below_480', bumped.count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
