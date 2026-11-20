/**
 * Keep only ANA_MACHINERY_P_LTD in Ana_corporation_db.
 * Does not modify Erp_test_db.
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const SCHEMA = 'Ana_corporation_db';
const KEEP_CODE = 'ANA_MACHINERY_P_LTD';

function json(v) {
  return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
}

async function main() {
  if (String(process.env.GCP_SQL_SCHEMA) !== SCHEMA) {
    throw new Error(`Refusing to run: GCP_SQL_SCHEMA is ${process.env.GCP_SQL_SCHEMA}, expected ${SCHEMA}`);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`SET statement_timeout = 0`);

    const keepRows = await prisma.$queryRawUnsafe(`
      SELECT company_id, company_code, name
      FROM "${SCHEMA}".companies
      WHERE company_code = '${KEEP_CODE}' AND deleted_at IS NULL
    `);
    if (keepRows.length !== 1) {
      throw new Error(`Expected exactly 1 live ${KEEP_CODE} company, found ${keepRows.length}`);
    }
    const keepId = Number(keepRows[0].company_id);

    const keepUsers = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT user_id
      FROM "${SCHEMA}".user_companies
      WHERE company_id = ${keepId}
    `);
    const keepUserIds = keepUsers.map((r) => Number(r.user_id));
    if (!keepUserIds.length) {
      throw new Error(`${KEEP_CODE} has no users; aborting so company data is not orphaned`);
    }
    const keepUserList = keepUserIds.join(', ');

    const toDelete = await prisma.$queryRawUnsafe(`
      SELECT company_id, company_code, name
      FROM "${SCHEMA}".companies
      WHERE company_id <> ${keepId}
      ORDER BY company_id
    `);
    console.log('keeping company:', json(keepRows[0]));
    console.log('keeping user ids:', keepUserIds);
    console.log(`deleting ${toDelete.length} other companies:`, json(toDelete));

    const beforeErp = await prisma.$queryRawUnsafe(
      `SELECT count(*)::bigint AS n FROM "Erp_test_db".companies`,
    );

    const result = await prisma.$transaction(
      async (tx) => {
        const deletedFiles = await tx.$executeRawUnsafe(`
          DELETE FROM "${SCHEMA}".file_assets
          WHERE organization_id IS DISTINCT FROM '${keepId}'
        `);

        const deletedAudit = await tx.$executeRawUnsafe(`
          DELETE FROM "${SCHEMA}".user_audit
          WHERE company_id IS DISTINCT FROM ${keepId}
             OR user_id IS NULL
             OR user_id NOT IN (${keepUserList})
        `);
        const deletedLogins = await tx.$executeRawUnsafe(`
          DELETE FROM "${SCHEMA}".user_login_history
          WHERE company_id IS DISTINCT FROM ${keepId}
             OR user_id IS NULL
             OR user_id NOT IN (${keepUserList})
        `);
        const deletedSessions = await tx.$executeRawUnsafe(`
          DELETE FROM "${SCHEMA}".user_sessions
          WHERE company_id IS DISTINCT FROM ${keepId}
             OR user_id IS NULL
             OR user_id NOT IN (${keepUserList})
        `);

        const deletedCompanies = await tx.$executeRawUnsafe(`
          DELETE FROM "${SCHEMA}".companies
          WHERE company_id <> ${keepId}
        `);

        const deletedUsers = await tx.$executeRawUnsafe(`
          DELETE FROM "${SCHEMA}".users
          WHERE user_id NOT IN (${keepUserList})
        `);

        const leftoverAudit = await tx.$executeRawUnsafe(`
          DELETE FROM "${SCHEMA}".user_audit
          WHERE user_id IS NULL OR company_id IS NULL
        `);

        const companiesLeft = await tx.$queryRawUnsafe(`
          SELECT company_id, company_code, name FROM "${SCHEMA}".companies
        `);
        const usersLeft = await tx.$queryRawUnsafe(`
          SELECT user_id, email, display_name FROM "${SCHEMA}".users ORDER BY user_id
        `);
        const otherCompanyRows = await tx.$queryRawUnsafe(`
          SELECT table_name, n FROM (
            SELECT 'user_companies' AS table_name, count(*) FROM "${SCHEMA}".user_companies WHERE company_id <> ${keepId}
            UNION ALL SELECT 'roles', count(*) FROM "${SCHEMA}".roles WHERE company_id IS NOT NULL AND company_id <> ${keepId}
            UNION ALL SELECT 'items', count(*) FROM "${SCHEMA}".items WHERE company_id <> ${keepId}
            UNION ALL SELECT 'vendors', count(*) FROM "${SCHEMA}".vendors WHERE company_id <> ${keepId}
            UNION ALL SELECT 'branches', count(*) FROM "${SCHEMA}".branches WHERE company_id <> ${keepId}
            UNION ALL SELECT 'employees', count(*) FROM "${SCHEMA}".employees WHERE company_id <> ${keepId}
          ) s(table_name, n)
        `);

        if (companiesLeft.length !== 1 || String(companiesLeft[0].company_code) !== KEEP_CODE) {
          throw new Error(`Safety check failed: companies left = ${json(companiesLeft)}`);
        }
        const leftover = otherCompanyRows.filter((r) => Number(r.n) > 0);
        if (leftover.length) {
          throw new Error(`Safety check failed: leftover other-company rows ${json(leftover)}`);
        }

        return {
          deletedFiles,
          deletedAudit,
          deletedLogins,
          deletedSessions,
          deletedCompanies,
          deletedUsers,
          leftoverAudit,
          companiesLeft,
          usersLeft,
        };
      },
      { timeout: 180000, maxWait: 20000 },
    );

    const afterErp = await prisma.$queryRawUnsafe(
      `SELECT count(*)::bigint AS n FROM "Erp_test_db".companies`,
    );
    if (String(beforeErp[0].n) !== String(afterErp[0].n)) {
      throw new Error('Erp_test_db company count changed — unexpected');
    }

    const summary = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM "${SCHEMA}".companies) AS companies,
        (SELECT count(*) FROM "${SCHEMA}".users) AS users,
        (SELECT count(*) FROM "${SCHEMA}".user_companies) AS memberships,
        (SELECT count(*) FROM "${SCHEMA}".roles WHERE company_id = ${keepId}) AS company_roles,
        (SELECT count(*) FROM "${SCHEMA}".roles WHERE company_id IS NULL) AS global_roles,
        (SELECT count(*) FROM "${SCHEMA}".branches) AS branches,
        (SELECT count(*) FROM "${SCHEMA}".warehouses) AS warehouses,
        (SELECT count(*) FROM "${SCHEMA}".employees) AS employees,
        (SELECT count(*) FROM "${SCHEMA}".items) AS items,
        (SELECT count(*) FROM "${SCHEMA}".vendors) AS vendors,
        (SELECT count(*) FROM "${SCHEMA}".modules) AS modules,
        (SELECT count(*) FROM "${SCHEMA}".permissions) AS permissions,
        (SELECT count(*) FROM "${SCHEMA}".super_admins) AS super_admins
    `);

    console.log('deleted:', {
      files: result.deletedFiles,
      audit: result.deletedAudit,
      logins: result.deletedLogins,
      sessions: result.deletedSessions,
      companies: result.deletedCompanies,
      users: result.deletedUsers,
    });
    console.log('remaining company:', json(result.companiesLeft));
    console.log('remaining users:', json(result.usersLeft));
    console.log('summary:', json(summary));
    console.log('Erp_test_db companies unchanged:', String(afterErp[0].n));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
