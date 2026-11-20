/**
 * Incremental sync: Erp_test_db → Ana_corporation_db (same Cloud SQL database).
 * Adds missing tables/columns/enums, then copies rows that Ana does not already have.
 * Existing Ana rows are not updated or deleted.
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const SRC = 'Erp_test_db';
const DST = 'Ana_corporation_db';

function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function qTable(schema, table) {
  return `${qIdent(schema)}.${qIdent(table)}`;
}

function rewriteSchema(sql) {
  return String(sql || '')
    .replaceAll(`"${SRC}"`, `"${DST}"`)
    .replaceAll(`${SRC}.`, `${DST}.`);
}

function qualifyFkDef(def, refTable) {
  return String(def || '').replace(
    /REFERENCES\s+(?:"[^"]+"\.)?(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/,
    `REFERENCES ${qTable(DST, refTable)}`,
  );
}

function selectCast(columnName, srcTyp, dstTyp) {
  const ident = `src.${qIdent(columnName)}`;
  if (!dstTyp || !srcTyp || srcTyp === dstTyp) return ident;
  if (/\[\]\s*$/.test(dstTyp) || /\[\]\s*$/.test(srcTyp)) {
    return `${ident}::text[]::${dstTyp}`;
  }
  return `${ident}::text::${dstTyp}`;
}

function topoSort(tables, deps) {
  const remaining = new Set(tables);
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining].filter((table) => {
      const needs = deps.get(table) || [];
      return needs.every((parent) => parent === table || !remaining.has(parent));
    });
    if (!ready.length) {
      ordered.push(...remaining);
      break;
    }
    ready.sort();
    for (const table of ready) {
      remaining.delete(table);
      ordered.push(table);
    }
  }
  return ordered;
}

async function main() {
  const prisma = new PrismaClient();
  const report = {
    enumsCreated: [],
    columnsAdded: [],
    tablesCreated: [],
    fksAdded: [],
    indexesAdded: [],
    rowsCopied: {},
    skipped: [],
    errors: [],
  };

  try {
    await prisma.$executeRawUnsafe(`SET statement_timeout = 0`);

    const srcTables = (
      await prisma.$queryRawUnsafe(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = '${SRC}' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `)
    ).map((r) => r.table_name);

    const dstTables = new Set(
      (
        await prisma.$queryRawUnsafe(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = '${DST}' AND table_type = 'BASE TABLE'
        `)
      ).map((r) => r.table_name),
    );

    const srcEnums = await prisma.$queryRawUnsafe(`
      SELECT t.typname,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = '${SRC}'
      GROUP BY t.typname
      ORDER BY t.typname
    `);
    const dstEnums = new Set(
      (
        await prisma.$queryRawUnsafe(`
          SELECT t.typname
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = '${DST}' AND t.typtype = 'e'
        `)
      ).map((r) => r.typname),
    );

    for (const enm of srcEnums) {
      if (dstEnums.has(enm.typname)) continue;
      const labels = enm.labels.map((l) => `'${String(l).replace(/'/g, "''")}'`).join(', ');
      await prisma.$executeRawUnsafe(
        `CREATE TYPE ${qTable(DST, enm.typname)} AS ENUM (${labels})`,
      );
      report.enumsCreated.push(enm.typname);
      dstEnums.add(enm.typname);
    }

    const missingTables = srcTables.filter((name) => !dstTables.has(name));
    for (const table of missingTables) {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE ${qTable(DST, table)} (LIKE ${qTable(SRC, table)} INCLUDING ALL)`,
      );
      report.tablesCreated.push(table);
      dstTables.add(table);
    }

    const srcCols = await prisma.$queryRawUnsafe(`
      SELECT
        c.relname AS table_name,
        a.attname AS column_name,
        a.attnum,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS typ,
        a.attnotnull,
        pg_get_expr(ad.adbin, ad.adrelid) AS def,
        a.attidentity,
        a.attgenerated
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname = '${SRC}'
        AND c.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `);

    const dstColRows = await prisma.$queryRawUnsafe(`
      SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${DST}'
        AND c.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
    `);
    const dstColSet = new Set(dstColRows.map((r) => `${r.table_name}.${r.column_name}`));
    const srcColMap = new Map();
    for (const col of srcCols) {
      if (!srcColMap.has(col.table_name)) srcColMap.set(col.table_name, []);
      srcColMap.get(col.table_name).push(col);
    }

    for (const col of srcCols) {
      const key = `${col.table_name}.${col.column_name}`;
      if (dstColSet.has(key) || !dstTables.has(col.table_name)) continue;
      const parts = [
        `ALTER TABLE ${qTable(DST, col.table_name)} ADD COLUMN ${qIdent(col.column_name)} ${rewriteSchema(col.typ)}`,
      ];
      if (col.attidentity === 'd') parts.push('GENERATED BY DEFAULT AS IDENTITY');
      if (col.attidentity === 'a') parts.push('GENERATED ALWAYS AS IDENTITY');
      if (col.attgenerated === 's' && col.def) {
        parts.push(`GENERATED ALWAYS AS (${rewriteSchema(col.def)}) STORED`);
      } else if (col.def && !col.attidentity) {
        parts.push(`DEFAULT ${rewriteSchema(col.def)}`);
      }
      if (col.attnotnull) parts.push('NOT NULL');
      await prisma.$executeRawUnsafe(parts.join(' '));
      report.columnsAdded.push(key);
      dstColSet.add(key);
    }

    const srcFks = await prisma.$queryRawUnsafe(`
      SELECT
        cl.relname AS table_name,
        fcl.relname AS ref_table,
        con.conname,
        pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_class fcl ON fcl.oid = con.confrelid
      WHERE ns.nspname = '${SRC}' AND con.contype = 'f'
    `);

    const dstFks = await prisma.$queryRawUnsafe(`
      SELECT cl.relname AS table_name, con.conname
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = '${DST}' AND con.contype = 'f'
    `);
    for (const fk of dstFks) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${qTable(DST, fk.table_name)} DROP CONSTRAINT IF EXISTS ${qIdent(fk.conname)}`,
      );
    }

    const srcIndexes = await prisma.$queryRawUnsafe(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = '${SRC}'
    `);
    const dstIndexNames = new Set(
      (
        await prisma.$queryRawUnsafe(`
          SELECT tablename, indexname
          FROM pg_indexes
          WHERE schemaname = '${DST}'
        `)
      ).map((r) => `${r.tablename}.${r.indexname}`),
    );
    for (const idx of srcIndexes) {
      const key = `${idx.tablename}.${idx.indexname}`;
      if (dstIndexNames.has(key) || !dstTables.has(idx.tablename)) continue;
      if (/CREATE UNIQUE INDEX/i.test(idx.indexdef) && /_pkey"?$/.test(idx.indexname)) continue;
      try {
        await prisma.$executeRawUnsafe(rewriteSchema(idx.indexdef));
        report.indexesAdded.push(key);
        dstIndexNames.add(key);
      } catch (err) {
        if (!/already exists/i.test(err.message)) {
          report.errors.push(`INDEX ${key}: ${err.message}`);
        }
      }
    }

    const dstTypes = await prisma.$queryRawUnsafe(`
      SELECT
        c.relname AS table_name,
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS typ
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${DST}'
        AND c.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
    `);
    const dstTypeMap = new Map(dstTypes.map((r) => [`${r.table_name}.${r.column_name}`, r.typ]));

    const pkCols = await prisma.$queryRawUnsafe(`
      SELECT cl.relname AS table_name, a.attname AS column_name, k.n AS ord
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
      JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
      WHERE ns.nspname = '${SRC}' AND con.contype = 'p'
      ORDER BY cl.relname, k.n
    `);
    const pkMap = new Map();
    for (const row of pkCols) {
      if (!pkMap.has(row.table_name)) pkMap.set(row.table_name, []);
      pkMap.get(row.table_name).push(row.column_name);
    }

    const fkDeps = await prisma.$queryRawUnsafe(`
      SELECT
        cl.relname AS table_name,
        fcl.relname AS ref_table
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_class fcl ON fcl.oid = con.confrelid
      JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
      WHERE con.contype = 'f'
        AND ns.nspname = '${SRC}'
        AND fns.nspname = '${SRC}'
    `);
    const deps = new Map();
    for (const table of srcTables) deps.set(table, []);
    for (const fk of fkDeps) {
      if (fk.table_name === fk.ref_table) continue;
      deps.get(fk.table_name)?.push(fk.ref_table);
    }
    const ordered = topoSort(srcTables, deps);

    let replica = false;
    try {
      await prisma.$executeRawUnsafe(`SET session_replication_role = replica`);
      replica = true;
    } catch {
      replica = false;
    }

    const copyOrder = replica ? srcTables : ordered;
    for (const table of copyOrder) {
      if (!dstTables.has(table)) continue;
      const cols = (srcColMap.get(table) || []).filter((c) => {
        if (c.attgenerated === 's') return false;
        return dstColSet.has(`${table}.${c.column_name}`);
      });
      if (!cols.length) {
        report.skipped.push(`${table}: no copyable columns`);
        continue;
      }
      const colSql = cols.map((c) => qIdent(c.column_name)).join(', ');
      const selectSql = cols
        .map((c) => selectCast(c.column_name, c.typ, dstTypeMap.get(`${table}.${c.column_name}`)))
        .join(', ');
      const hasIdentity = cols.some((c) => c.attidentity);
      const pk = pkMap.get(table) || [];
      let sql = `INSERT INTO ${qTable(DST, table)} (${colSql})`;
      if (hasIdentity) sql += ` OVERRIDING SYSTEM VALUE`;
      sql += ` SELECT ${selectSql} FROM ${qTable(SRC, table)} src`;
      if (pk.length) {
        const pred = pk
          .map((c) => `dst.${qIdent(c)} = src.${qIdent(c)}`)
          .join(' AND ');
        sql += ` WHERE NOT EXISTS (SELECT 1 FROM ${qTable(DST, table)} dst WHERE ${pred})`;
      }
      try {
        const inserted = await prisma.$executeRawUnsafe(sql);
        report.rowsCopied[table] = inserted;
      } catch (err) {
        report.errors.push(`DATA ${table}: ${err.message}`);
      }
    }

    if (replica) {
      try {
        await prisma.$executeRawUnsafe(`SET session_replication_role = origin`);
      } catch {
        /* ignore */
      }
    }

    for (const fk of srcFks) {
      if (!dstTables.has(fk.table_name)) continue;
      const key = `${fk.table_name}.${fk.conname}`;
      try {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE ${qTable(DST, fk.table_name)} ADD CONSTRAINT ${qIdent(fk.conname)} ${qualifyFkDef(fk.def, fk.ref_table)}`,
        );
        report.fksAdded.push(key);
      } catch (err) {
        report.errors.push(`FK ${key}: ${err.message}`);
      }
    }

    const sequences = await prisma.$queryRawUnsafe(`
      SELECT
        c.relname AS table_name,
        a.attname AS column_name,
        pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS seq
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${DST}'
        AND c.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND (a.attidentity IN ('a', 'd') OR pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL)
    `);
    for (const seq of sequences) {
      if (!seq.seq) continue;
      await prisma.$executeRawUnsafe(`
        SELECT setval(
          '${String(seq.seq).replace(/'/g, "''")}'::regclass,
          COALESCE((SELECT MAX(${qIdent(seq.column_name)}) FROM ${qTable(DST, seq.table_name)}), 1),
          true
        )
      `);
    }

    const counts = [];
    for (const table of srcTables) {
      if (!dstTables.has(table)) continue;
      const srcCount = await prisma.$queryRawUnsafe(
        `SELECT count(*)::bigint AS n FROM ${qTable(SRC, table)}`,
      );
      const dstCount = await prisma.$queryRawUnsafe(
        `SELECT count(*)::bigint AS n FROM ${qTable(DST, table)}`,
      );
      counts.push({
        table,
        erp: Number(srcCount[0].n),
        ana: Number(dstCount[0].n),
      });
    }

    console.log(
      JSON.stringify(
        {
          replicaRole: replica,
          enumsCreated: report.enumsCreated,
          tablesCreated: report.tablesCreated,
          columnsAdded: report.columnsAdded,
          fksAdded: report.fksAdded,
          indexesAdded: report.indexesAdded,
          rowsCopied: report.rowsCopied,
          skipped: report.skipped,
          errors: report.errors,
          counts,
        },
        null,
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
