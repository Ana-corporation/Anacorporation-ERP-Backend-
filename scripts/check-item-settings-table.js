const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT to_regclass('public.company_item_settings')::text AS table_name"
  );
  console.log(JSON.stringify(rows));
  const count = await prisma.companyItemSettings.count();
  console.log('settings_rows', count);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
