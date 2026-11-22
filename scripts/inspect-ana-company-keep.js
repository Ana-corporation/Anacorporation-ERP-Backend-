require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const SCHEMA = 'Ana_corporation_db';
const KEEP = 'ANA_MACHINERY_P_LTD';

async function main() {
  const prisma = new PrismaClient();
  try {
    const companies = await prisma.$queryRawUnsafe(`
      SELECT * FROM "${SCHEMA}".companies ORDER BY company_id
    `);
    console.log('companies:', JSON.stringify(companies, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));

    const match = await prisma.$queryRawUnsafe(`
      SELECT company_id, company_code, name, legal_name, status
      FROM "${SCHEMA}".companies
      WHERE company_code ILIKE ${"'%" + KEEP.replace(/'/g, "''") + "%'"}
         OR name ILIKE ${"'%" + KEEP.replace(/'/g, "''") + "%'"}
         OR legal_name ILIKE ${"'%" + KEEP.replace(/'/g, "''") + "%'"}
    `);
    console.log('keep matches:', JSON.stringify(match, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));

    const cols = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'companies'
      ORDER BY ordinal_position
    `);
    console.log('company columns:', cols.map((c) => c.column_name));

    const companyFks = await prisma.$queryRawUnsafe(`
      SELECT
        cl.relname AS table_name,
        a.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_class fcl ON fcl.oid = con.confrelid
      JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
      JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
      WHERE ns.nspname = '${SCHEMA}'
        AND fns.nspname = '${SCHEMA}'
        AND fcl.relname = 'companies'
        AND con.contype = 'f'
      ORDER BY 1, 2
    `);
    console.log('tables with FK to companies:', JSON.stringify(companyFks));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
