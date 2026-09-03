require('dotenv').config();
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const action = process.argv[2] || 'list'; // list | drop

async function main() {
  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const names = tables.map((t) => t.table_name);
    console.log('Tables in public schema (' + names.length + '):');
    names.forEach((n) => console.log('  -', n));

    if (action === 'drop') {
      console.log('\nDropping all tables, types, and resetting public schema...');
      await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE`);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA public`);
      await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO PUBLIC`);
      console.log('Done. Database is empty.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
