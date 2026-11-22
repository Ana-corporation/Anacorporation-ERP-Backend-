/**
 * TEST DATA ONLY. Lists — and with --confirm deletes — items numbered by the old store-based
 * series (ANA + store code + serial, e.g. ANARM00001, ANABO00001), then resets every ITEM
 * number-series counter and lock so numbering starts again at 00001.
 *
 * An item is "store-based" when its code is ANA + one of --store-codes + digits AND that code
 * segment is not its own category's code (so a category-based ANARM00001 under Raw Materials is
 * never touched). Rows that reference a deleted item are deleted too (stock ledger, balances,
 * location stock, inventory document lines, custom field values); import rows lose the link.
 *
 * Default = dry run (prints what would be deleted). Nothing is deleted without --confirm.
 *   node scripts/with-node-env.js development node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js \
 *     scripts/cleanup-ana-test-part-numbers.ts --companyId 28
 */
import { Prisma, PrismaClient } from '@prisma/client';

const DEFAULT_STORE_CODES = ['RM', 'SP', 'FG', 'BO', 'EL', 'GN', 'OL'];

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const raw = value('--companyId');
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error('Usage: cleanup-ana-test-part-numbers.ts --companyId <id> [--prefix ANA] [--store-codes RM,BO,...] [--confirm]');
  }
  const prefix = (value('--prefix') ?? 'ANA').toUpperCase();
  const storeCodes = (value('--store-codes') ?? DEFAULT_STORE_CODES.join(',')).split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  return { companyId: BigInt(raw), prefix, storeCodes, confirm: argv.includes('--confirm') };
}

async function main() {
  const { companyId, prefix, storeCodes, confirm } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findFirst({ where: { companyId }, select: { companyCode: true } });
    if (!company) throw new Error(`Company ${companyId} not found`);
    const pattern = `^${prefix}(${storeCodes.join('|')})[0-9]+$`;

    const items = await prisma.$queryRaw<
      Array<{ item_id: bigint; item_code: string; description: string; deleted: boolean; ledger: number; balances: number; doc_lines: number }>
    >`
      SELECT i.item_id, i.item_code, i.description, i.deleted_at IS NOT NULL AS deleted,
        (SELECT COUNT(*)::int FROM stock_ledger_entries e WHERE e.item_id = i.item_id) AS ledger,
        (SELECT COUNT(*)::int FROM stock_balances b WHERE b.item_id = i.item_id) AS balances,
        (SELECT COUNT(*)::int FROM inventory_document_lines d WHERE d.item_id = i.item_id) AS doc_lines
      FROM items i
      LEFT JOIN item_groups g ON g.item_group_id = i.item_group_id
      WHERE i.company_id = ${companyId}
        AND i.item_code ~ ${pattern}
        AND (g.category_code IS NULL
             OR substring(i.item_code FROM ${`^${prefix}([A-Z]+)[0-9]+$`}) <> g.category_code)
      ORDER BY i.item_code`;
    const lines = await prisma.$queryRaw<Array<{ segment_code: string; last_number: number; is_locked: boolean }>>`
      SELECT l.segment_code, l.last_number, l.is_locked FROM number_series_lines l
      JOIN number_series_configs c ON c.number_series_config_id = l.number_series_config_id
      WHERE c.company_id = ${companyId} AND c.document_type::text = 'ITEM' ORDER BY l.segment_code`;

    console.log(`Company ${companyId} (${company.companyCode}) — ${confirm ? 'DELETING' : 'DRY RUN (nothing deleted)'}`);
    console.log(`Store-based codes matched: ${pattern}`);
    console.log(`\nItems that would be deleted: ${items.length}`);
    if (items.length) console.table(items.map((i) => ({ code: i.item_code, name: i.description, deleted: i.deleted, ledger: i.ledger, balances: i.balances, docLines: i.doc_lines })));
    console.log(`\nCounters that would be reset to 0 (and unlocked): ${lines.length}`);
    if (lines.length) console.table(lines.map((l) => ({ code: l.segment_code, lastNumber: l.last_number, locked: l.is_locked })));

    if (!confirm) {
      console.log('\nDry run only. Re-run with --confirm to delete.');
      return;
    }

    const ids = items.map((i) => i.item_id);
    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        if (ids.length) {
          const where = { itemId: { in: ids } };
          await tx.stockLedgerEntry.deleteMany({ where });
          await tx.stockBalance.deleteMany({ where });
          await tx.itemWarehouseStock.deleteMany({ where });
          await tx.inventoryDocumentLine.deleteMany({ where });
          await tx.customFieldValue.deleteMany({ where: { companyId, entityType: 'item', recordId: { in: ids } } });
          await tx.openingStockImportRow.updateMany({ where: { matchedItemId: { in: ids } }, data: { matchedItemId: null } });
          await tx.openingStockImportRow.updateMany({ where: { createdItemId: { in: ids } }, data: { createdItemId: null } });
          await tx.item.deleteMany({ where: { companyId, itemId: { in: ids } } });
        }
        await tx.$executeRaw`
          UPDATE number_series_lines l SET last_number = 0, is_locked = false, updated_at = NOW()
          FROM number_series_configs c
          WHERE c.number_series_config_id = l.number_series_config_id AND c.company_id = ${companyId} AND c.document_type::text = 'ITEM'`;
        await tx.$executeRaw`
          UPDATE number_series_configs SET is_locked = false, updated_at = NOW()
          WHERE company_id = ${companyId} AND document_type::text = 'ITEM'`;
      },
      { timeout: 120_000 },
    );
    console.log(`\nDeleted ${ids.length} item(s); counters reset.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
