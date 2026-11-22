require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const SCHEMA = 'Ana_corporation_db';
const KEEP_CODE = 'ANA_MACHINERY_P_LTD';

function json(v) {
  return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const keep = await prisma.$queryRawUnsafe(`
      SELECT company_id, company_code, name
      FROM "${SCHEMA}".companies
      WHERE company_code = '${KEEP_CODE}'
    `);
    if (!keep.length) throw new Error(`Company ${KEEP_CODE} not found in ${SCHEMA}`);
    const keepId = keep[0].company_id.toString();
    console.log('KEEP', keep[0]);

    const members = await prisma.$queryRawUnsafe(`
      SELECT uc.user_id, u.email, u.display_name, uc.status, uc.is_primary_admin
      FROM "${SCHEMA}".user_companies uc
      JOIN "${SCHEMA}".users u ON u.user_id = uc.user_id
      WHERE uc.company_id = ${keepId}
    `);
    console.log('members of keep company:', json(members));

    const employees = await prisma.$queryRawUnsafe(`
      SELECT employee_id, user_id, employee_code, first_name, last_name
      FROM "${SCHEMA}".employees
      WHERE company_id = ${keepId}
    `);
    console.log('employees:', json(employees));

    const superAdmins = await prisma.$queryRawUnsafe(`
      SELECT super_admin_id, name, email, is_active FROM "${SCHEMA}".super_admins
    `);
    console.log('super_admins (kept, not company data):', json(superAdmins));

    const counts = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM "${SCHEMA}".companies) AS companies,
        (SELECT count(*) FROM "${SCHEMA}".companies WHERE company_id = ${keepId}) AS keep_companies,
        (SELECT count(*) FROM "${SCHEMA}".users) AS users,
        (SELECT count(*) FROM "${SCHEMA}".user_companies WHERE company_id = ${keepId}) AS keep_memberships,
        (SELECT count(*) FROM "${SCHEMA}".roles WHERE company_id = ${keepId} OR company_id IS NULL) AS keep_roles,
        (SELECT count(*) FROM "${SCHEMA}".roles) AS roles,
        (SELECT count(*) FROM "${SCHEMA}".items WHERE company_id = ${keepId}) AS keep_items,
        (SELECT count(*) FROM "${SCHEMA}".items) AS items,
        (SELECT count(*) FROM "${SCHEMA}".vendors WHERE company_id = ${keepId}) AS keep_vendors,
        (SELECT count(*) FROM "${SCHEMA}".branches WHERE company_id = ${keepId}) AS keep_branches,
        (SELECT count(*) FROM "${SCHEMA}".warehouses WHERE company_id = ${keepId}) AS keep_warehouses
    `);
    console.log('counts:', json(counts));

    const fks = await prisma.$queryRawUnsafe(`
      SELECT
        cl.relname AS table_name,
        con.conname,
        CASE con.confdeltype
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'd' THEN 'SET DEFAULT'
        END AS on_delete,
        pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_class fcl ON fcl.oid = con.confrelid
      JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
      WHERE ns.nspname = '${SCHEMA}'
        AND fns.nspname = '${SCHEMA}'
        AND fcl.relname IN ('companies', 'users', 'roles')
        AND con.contype = 'f'
      ORDER BY fcl.relname, cl.relname
    `);
    console.log('delete actions:', json(fks));

    const files = await prisma.$queryRawUnsafe(`
      SELECT organization_id, count(*)::bigint AS n
      FROM "${SCHEMA}".file_assets
      GROUP BY 1
    `);
    console.log('file_assets by org:', json(files));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
