/**
 * Fix duplicate user_companies.employee_id per company (raw SQL — no Prisma model).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const dupes = await prisma.$queryRaw`
    SELECT company_id, employee_id, COUNT(*)::int AS cnt
    FROM user_companies
    WHERE deleted_at IS NULL
      AND employee_id IS NOT NULL
      AND btrim(employee_id) <> ''
    GROUP BY company_id, employee_id
    HAVING COUNT(*) > 1
    ORDER BY company_id, employee_id
  `;

  console.log('Duplicate groups:', dupes.length);

  for (const row of dupes) {
    const companyId = row.company_id;
    const employeeId = row.employee_id;

    const rows = await prisma.$queryRaw`
      SELECT user_company_id
      FROM user_companies
      WHERE company_id = ${companyId}
        AND employee_id = ${employeeId}
        AND deleted_at IS NULL
      ORDER BY user_company_id ASC
    `;

    for (let i = 1; i < rows.length; i += 1) {
      const userCompanyId = rows[i].user_company_id;
      let n = 1;
      let candidate = null;

      while (n <= 99999) {
        candidate = `USER${String(n).padStart(3, '0')}`;
        const taken = await prisma.$queryRaw`
          SELECT 1
          FROM user_companies
          WHERE company_id = ${companyId}
            AND deleted_at IS NULL
            AND employee_id = ${candidate}
          LIMIT 1
        `;
        if (taken.length === 0) break;
        n += 1;
        candidate = null;
      }

      if (!candidate) {
        throw new Error(`Could not allocate code for user_company_id ${userCompanyId}`);
      }

      await prisma.$executeRaw`
        UPDATE user_companies
        SET employee_id = ${candidate}, updated_at = NOW()
        WHERE user_company_id = ${userCompanyId}
      `;
      console.log(
        `company ${companyId}: user_company_id ${userCompanyId} ${employeeId} -> ${candidate}`,
      );
    }
  }

  const remaining = await prisma.$queryRaw`
    SELECT company_id, employee_id, COUNT(*)::int AS cnt
    FROM user_companies
    WHERE deleted_at IS NULL
      AND employee_id IS NOT NULL
      AND btrim(employee_id) <> ''
    GROUP BY company_id, employee_id
    HAVING COUNT(*) > 1
  `;
  console.log('Remaining duplicate groups:', remaining.length);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
