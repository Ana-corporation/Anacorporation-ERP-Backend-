require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

function json(v) {
  return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const company = await prisma.$queryRawUnsafe(`
      SELECT company_id, company_code, name, status, default_currency_id
      FROM "Erp_test_db".companies WHERE company_code = 'PLATFORM'
    `);
    console.log('erp PLATFORM company', json(company));
    const cid = company[0]?.company_id;
    if (!cid) throw new Error('PLATFORM not in Erp_test_db');

    const members = await prisma.$queryRawUnsafe(`
      SELECT uc.*, u.user_id, u.user_code, u.username, u.email, u.display_name, u.first_name, u.last_name
      FROM "Erp_test_db".user_companies uc
      JOIN "Erp_test_db".users u ON u.user_id = uc.user_id
      WHERE uc.company_id = ${cid}
    `);
    console.log('erp PLATFORM members', json(members));

    const roles = await prisma.$queryRawUnsafe(`
      SELECT role_id, company_id, role_code, role_name, is_system, role_type, system_template_key
      FROM "Erp_test_db".roles WHERE company_id = ${cid}
    `);
    console.log('erp PLATFORM roles', json(roles));

    const userRoles = await prisma.$queryRawUnsafe(`
      SELECT ur.* FROM "Erp_test_db".user_roles ur WHERE ur.company_id = ${cid}
    `);
    console.log('erp PLATFORM user_roles', json(userRoles));

    const auth = await prisma.$queryRawUnsafe(`
      SELECT ua.user_id, ua.employee_code, ua.is_active
      FROM "Erp_test_db".user_authentication ua
      WHERE ua.user_id IN (SELECT user_id FROM "Erp_test_db".user_companies WHERE company_id = ${cid})
    `);
    console.log('erp PLATFORM auth', json(auth));

    const subs = await prisma.$queryRawUnsafe(`
      SELECT * FROM "Erp_test_db".company_subscriptions WHERE company_id = ${cid}
    `);
    console.log('erp PLATFORM subscriptions', json(subs));

    const modules = await prisma.$queryRawUnsafe(`
      SELECT count(*)::bigint AS n FROM "Erp_test_db".company_modules WHERE company_id = ${cid}
    `);
    console.log('erp PLATFORM company_modules', json(modules));

    const rolePerms = await prisma.$queryRawUnsafe(`
      SELECT count(*)::bigint AS n FROM "Erp_test_db".role_permissions rp
      JOIN "Erp_test_db".roles r ON r.role_id = rp.role_id
      WHERE r.company_id = ${cid}
    `);
    console.log('erp PLATFORM role_permissions', json(rolePerms));

    const anaCompanies = await prisma.$queryRawUnsafe(`
      SELECT company_id, company_code, name FROM "Ana_corporation_db".companies
    `);
    console.log('ana companies now', json(anaCompanies));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
