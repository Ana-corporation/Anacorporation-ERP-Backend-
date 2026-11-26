/**
 * LOCAL / DEV only (Erp_test_db):
 * Remove ANAELC00006..00009 from Opening Stock draft OS-000004 and soft-delete from Item Master.
 *
 *   node scripts/with-node-env.js development node scripts/remove-ana-servo-elc-local.js
 */
require('./apply-gcp-sql-env');
const { PrismaClient } = require('@prisma/client');

const COMPANY_ID = 28n;
const CODES = ['ANAELC00006', 'ANAELC00007', 'ANAELC00008', 'ANAELC00009'];

async function main() {
  if (process.env.APP_DB_LABEL === 'PROD' || process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run on PROD/live. Use development / Erp_test_db only.');
  }

  const prisma = new PrismaClient();
  const schema = (await prisma.$queryRawUnsafe(`select current_schema() as s`))[0].s;
  if (schema !== 'Erp_test_db') {
    throw new Error(`Expected Erp_test_db, got ${schema}`);
  }

  const items = await prisma.item.findMany({
    where: { companyId: COMPANY_ID, itemCode: { in: CODES }, deletedAt: null },
    select: { itemId: true, itemCode: true, description: true },
  });
  if (!items.length) {
    console.log(JSON.stringify({ ok: true, schema, message: 'No active items found', codes: CODES }));
    await prisma.$disconnect();
    return;
  }

  const itemIds = items.map((i) => i.itemId);

  const result = await prisma.$transaction(async (tx) => {
    const lines = await tx.inventoryDocumentLine.findMany({
      where: {
        companyId: COMPANY_ID,
        itemId: { in: itemIds },
        document: { documentType: 'OPENING_STOCK', deletedAt: null, status: 'DRAFT' },
      },
      select: { lineId: true, documentId: true, itemId: true },
    });

    const docIds = [...new Set(lines.map((l) => l.documentId.toString()))].map((s) => BigInt(s));

    if (lines.length) {
      await tx.inventoryDocumentLine.deleteMany({
        where: { lineId: { in: lines.map((l) => l.lineId) } },
      });
    }

    for (const docId of docIds) {
      const agg = await tx.inventoryDocumentLine.aggregate({
        where: { documentId: docId },
        _count: { _all: true },
        _sum: { quantity: true, lineTotal: true },
      });
      await tx.inventoryDocument.update({
        where: { documentId: docId },
        data: {
          totalLines: agg._count._all,
          totalQuantity: agg._sum.quantity ?? 0,
          totalValue: agg._sum.lineTotal ?? 0,
          updatedAt: new Date(),
        },
      });
    }

    const now = new Date();
    await tx.item.updateMany({
      where: { itemId: { in: itemIds }, companyId: COMPANY_ID },
      data: {
        deletedAt: now,
        isActive: false,
        status: 'inactive',
        updatedAt: now,
      },
    });

    return {
      removedOsLines: lines.length,
      documentsTouched: docIds.map(String),
      softDeletedItems: items.map((i) => ({
        itemId: i.itemId.toString(),
        itemCode: i.itemCode,
        description: i.description,
      })),
    };
  });

  console.log(JSON.stringify({ ok: true, schema, label: process.env.APP_DB_LABEL, ...result }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
