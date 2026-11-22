/**
 * Links every item of a store to one inventory location (Item Master warehouse tab rows,
 * qty 0). No stock is posted — quantities come later through Opening Stock.
 * Items already linked to the location are skipped. Default = dry run; add --confirm to write.
 *
 *   node scripts/with-node-env.js production node -r ./scripts/apply-gcp-sql-env.js \
 *     -r tsconfig-paths/register ./node_modules/ts-node/dist/bin.js \
 *     scripts/link-store-items-to-location.ts --companyId 28 --store ES --location ELS-001 [--confirm]
 */
import { PrismaClient, UserAuditAction } from '@prisma/client';

function arg(argv: string[], flag: string) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const companyRaw = arg(argv, '--companyId');
  const storeCode = arg(argv, '--store')?.toUpperCase();
  const locationCode = arg(argv, '--location')?.toUpperCase();
  if (!companyRaw || !/^\d+$/.test(companyRaw) || !storeCode || !locationCode) {
    throw new Error('Usage: link-store-items-to-location.ts --companyId <id> --store <code> --location <code> [--confirm]');
  }
  const companyId = BigInt(companyRaw);
  const confirm = argv.includes('--confirm');
  const prisma = new PrismaClient();
  try {
    const store = await prisma.storeCategory.findFirst({
      where: { companyId, deletedAt: null, numberSeriesCode: storeCode },
      select: { storeCategoryId: true, name: true },
    });
    if (!store) throw new Error(`Store ${storeCode} not found`);
    const location = await prisma.warehouse.findFirst({
      where: { companyId, deletedAt: null, warehouseCode: locationCode },
      select: { warehouseId: true, name: true, isActive: true, storeCategoryId: true },
    });
    if (!location) throw new Error(`Location ${locationCode} not found`);
    if (!location.isActive) throw new Error(`Location ${locationCode} is inactive`);
    if (location.storeCategoryId !== store.storeCategoryId) {
      throw new Error(`Location ${locationCode} does not belong to ${store.name}`);
    }

    const items = await prisma.item.findMany({
      where: {
        companyId,
        deletedAt: null,
        storeCategoryId: store.storeCategoryId,
        warehouseStock: { none: { warehouseId: location.warehouseId } },
      },
      select: { itemId: true, itemCode: true },
      orderBy: { itemCode: 'asc' },
    });
    const already = await prisma.itemWarehouseStock.count({
      where: { companyId, warehouseId: location.warehouseId, item: { storeCategoryId: store.storeCategoryId, deletedAt: null } },
    });

    console.log(`${confirm ? 'LINKING' : 'DRY RUN'} — ${store.name} items → ${locationCode} (${location.name})`);
    console.log(`to link: ${items.length}${items.length ? ` (${items[0].itemCode} … ${items[items.length - 1].itemCode})` : ''}; already linked: ${already}`);
    if (!confirm || items.length === 0) {
      if (!confirm) console.log('Dry run only. Re-run with --confirm to write.');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.itemWarehouseStock.createMany({
        data: items.map((i) => ({ companyId, itemId: i.itemId, warehouseId: location.warehouseId })),
        skipDuplicates: true,
      });
      await tx.userAudit.create({
        data: {
          companyId,
          action: UserAuditAction.update,
          entityName: 'ItemWarehouseStock',
          entityId: location.warehouseId,
          newValue: { action: 'link-store-items', store: storeCode, location: locationCode, items: items.length },
        },
      });
    });
    console.log(`Linked ${items.length} item(s) to ${locationCode}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
