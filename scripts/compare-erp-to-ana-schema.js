/**
 * Compare Erp_test_db vs Ana_corporation_db (schemas in swenter-dev).
 * Prints table/column/row gaps. Does not write.
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const SRC = 'Erp_test_db';
const DST = 'Ana_corporation_db';

async function main() {
  const prisma = new PrismaClient();
  try {
    const schemas = await prisma.$queryRawUnsafe(`
      SELECT nspname AS schema
      FROM pg_namespace
      WHERE nspname IN ('${SRC}', '${DST}')
      ORDER BY 1
    `);
    console.log('schemas:', JSON.stringify(schemas));

    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('${SRC}', '${DST}')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `);

    const srcTables = tables.filter((t) => t.table_schema === SRC).map((t) => t.table_name);
    const dstTables = tables.filter((t) => t.table_schema === DST).map((t) => t.table_name);
    const srcSet = new Set(srcTables);
    const dstSet = new Set(dstTables);

    const missingInAna = srcTables.filter((n) => !dstSet.has(n));
    const extraInAna = dstTables.filter((n) => !srcSet.has(n));

    console.log(`Erp_test_db tables: ${srcTables.length}`);
    console.log(`Ana_corporation_db tables: ${dstTables.length}`);
    console.log('missing tables in Ana:', missingInAna);
    console.log('extra tables in Ana:', extraInAna);

    const shared = srcTables.filter((n) => dstSet.has(n));
    const colGaps = [];
    const rowGaps = [];

    for (const name of shared) {
      const cols = await prisma.$queryRawUnsafe(`
        SELECT table_schema, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema IN ('${SRC}', '${DST}')
          AND table_name = '${name.replace(/'/g, "''")}'
        ORDER BY ordinal_position
      `);
      const srcCols = cols.filter((c) => c.table_schema === SRC).map((c) => c.column_name);
      const dstCols = cols.filter((c) => c.table_schema === DST).map((c) => c.column_name);
      const dstColSet = new Set(dstCols);
      const missingCols = srcCols.filter((c) => !dstColSet.has(c));
      if (missingCols.length) {
        colGaps.push({ table: name, missingCols });
      }

      const srcCount = await prisma.$queryRawUnsafe(
        `SELECT count(*)::bigint AS n FROM "${SRC}"."${name}"`,
      );
      const dstCount = await prisma.$queryRawUnsafe(
        `SELECT count(*)::bigint AS n FROM "${DST}"."${name}"`,
      );
      const s = Number(srcCount[0].n);
      const d = Number(dstCount[0].n);
      if (s !== d) {
        rowGaps.push({ table: name, erp: s, ana: d, missingRows: Math.max(0, s - d) });
      }
    }

    console.log('column gaps:', JSON.stringify(colGaps, null, 2));
    console.log('row count gaps (erp vs ana):', JSON.stringify(rowGaps, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
