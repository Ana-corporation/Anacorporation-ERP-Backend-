/**
 * Restore PLATFORM + OWNER001 into Ana_corporation_db from Erp_test_db.
 * Does not restore other tenant companies.
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const SRC = 'Erp_test_db';
const DST = 'Ana_corporation_db';
const PLATFORM_CODE = 'PLATFORM';

function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
function qTable(schema, table) {
  return `${qIdent(schema)}.${qIdent(table)}`;
}
function selectCast(columnName, srcTyp, dstTyp) {
  const ident = `src.${qIdent(columnName)}`;
  if (!dstTyp || !srcTyp || srcTyp === dstTyp) return ident;
  if (/\[\]\s*$/.test(dstTyp) || /\[\]\s*$/.test(srcTyp)) {
    return `${ident}::text[]::${dstTyp}`;
  }
  return `${ident}::text::${dstTyp}`;
}

async function columnMeta(prisma, schema) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      c.relname AS table_name,
      a.attname AS column_name,
      a.attidentity,
      a.attgenerated,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS typ
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum
  `);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, []);
    map.get(row.table_name).push(row);
  }
  return map;
}

async function copyWhere(prisma, srcCols, dstCols, table, whereSql) {
  const src = srcCols.get(table) || [];
  const dstByName = new Map((dstCols.get(table) || []).map((c) => [c.column_name, c]));
  const cols = src.filter((c) => c.attgenerated !== 's' && dstByName.has(c.column_name));
  if (!cols.length) return 0;
  const colSql = cols.map((c) => qIdent(c.column_name)).join(', ');
  const selectSql = cols
    .map((c) => selectCast(c.column_name, c.typ, dstByName.get(c.column_name).typ))
    .join(', ');
  const hasIdentity = cols.some((c) => c.attidentity);
  const pk = cols.find((c) => c.column_name.endsWith('_id') && c.attidentity) || cols[0];
  let sql = `INSERT INTO ${qTable(DST, table)} (${colSql})`;
  if (hasIdentity) sql += ` OVERRIDING SYSTEM VALUE`;
  sql += ` SELECT ${selectSql} FROM ${qTable(SRC, table)} src WHERE ${whereSql}`;
  if (pk) {
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM ${qTable(DST, table)} dst
      WHERE dst.${qIdent(pk.column_name)} = src.${qIdent(pk.column_name)}
    )`;
  }
  return prisma.$executeRawUnsafe(sql);
}

async function main() {
  if (String(process.env.GCP_SQL_SCHEMA) !== DST) {
    throw new Error(`GCP_SQL_SCHEMA must be ${DST}`);
  }
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`SET statement_timeout = 0`);
    const srcCols = await columnMeta(prisma, SRC);
    const dstCols = await columnMeta(prisma, DST);

    const platform = await prisma.$queryRawUnsafe(`
      SELECT company_id FROM ${qTable(SRC, 'companies')} WHERE company_code = '${PLATFORM_CODE}'
    `);
    if (!platform.length) throw new Error('PLATFORM company missing in Erp_test_db');
    const companyId = Number(platform[0].company_id);

    const members = await prisma.$queryRawUnsafe(`
      SELECT user_id FROM ${qTable(SRC, 'user_companies')} WHERE company_id = ${companyId}
    `);
    const userIds = members.map((r) => Number(r.user_id));
    if (!userIds.length) throw new Error('PLATFORM has no users in Erp_test_db');
    const userList = userIds.join(', ');

    const copied = {};
    copied.users = await copyWhere(prisma, srcCols, dstCols, 'users', `src.user_id IN (${userList})`);
    copied.companies = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'companies',
      `src.company_id = ${companyId}`,
    );
    copied.user_authentication = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'user_authentication',
      `src.user_id IN (${userList})`,
    );
    copied.roles = await copyWhere(prisma, srcCols, dstCols, 'roles', `src.company_id = ${companyId}`);
    copied.user_companies = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'user_companies',
      `src.company_id = ${companyId}`,
    );
    copied.user_roles = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'user_roles',
      `src.company_id = ${companyId}`,
    );
    copied.role_permissions = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'role_permissions',
      `src.role_id IN (SELECT role_id FROM ${qTable(SRC, 'roles')} WHERE company_id = ${companyId})`,
    );
    copied.company_subscriptions = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'company_subscriptions',
      `src.company_id = ${companyId}`,
    );
    copied.company_modules = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'company_modules',
      `src.company_id = ${companyId}`,
    );
    copied.company_security_policies = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'company_security_policies',
      `src.company_id = ${companyId}`,
    );
    copied.company_module_overrides = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'company_module_overrides',
      `src.company_id = ${companyId}`,
    );
    copied.user_module_access = await copyWhere(
      prisma,
      srcCols,
      dstCols,
      'user_module_access',
      `src.company_id = ${companyId}`,
    );

    const anaCompanies = await prisma.$queryRawUnsafe(`
      SELECT company_id, company_code, name, status
      FROM ${qTable(DST, 'companies')}
      ORDER BY company_id
    `);
    const owner = await prisma.$queryRawUnsafe(`
      SELECT u.user_id, u.username, u.email, uc.employee_id, r.role_code
      FROM ${qTable(DST, 'users')} u
      JOIN ${qTable(DST, 'user_companies')} uc ON uc.user_id = u.user_id
      LEFT JOIN ${qTable(DST, 'user_roles')} ur ON ur.user_id = u.user_id AND ur.company_id = uc.company_id AND ur.is_active = true
      LEFT JOIN ${qTable(DST, 'roles')} r ON r.role_id = ur.role_id
      WHERE uc.company_id = ${companyId}
    `);

    console.log(
      JSON.stringify(
        { copied, companies: anaCompanies, platformOwner: owner },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
