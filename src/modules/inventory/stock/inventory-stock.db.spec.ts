/**
 * Real-database test of posting, ledger, concurrency and tenant isolation.
 * Creates two throw-away companies and deletes them afterwards.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest inventory-stock.db
 */
import { BusinessException } from '@/common/exceptions/business.exception';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { BranchesRepository } from '@/modules/organization/branches/branches.repository';
import { StorageBinsRepository } from '@/modules/organization/storage-bins/storage-bins.repository';
import { StorageBinsService } from '@/modules/organization/storage-bins/storage-bins.service';
import { WarehousesRepository } from '@/modules/organization/warehouses/warehouses.repository';
import { WarehousesService } from '@/modules/organization/warehouses/warehouses.service';
import { InventoryDocumentType } from '@prisma/client';
import { InventoryDocumentsRepository } from './inventory-documents.repository';
import { InventoryDocumentsService } from './inventory-documents.service';
import { InventoryLineResolverService } from './inventory-line-resolver.service';
import { StockPostingService } from './stock-posting.service';
import { StockQueryService } from './stock-query.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Inventory DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;
const { OPENING_STOCK, MATERIAL_ISSUE, STOCK_ADJUSTMENT } = InventoryDocumentType;

type Doc = Record<string, any>;

run('Inventory stock (database)', () => {
  jest.setTimeout(180_000);

  const prisma = new PrismaService();
  const unrestricted = { isRestricted: false, branchIds: [], departmentIds: [], warehouseIds: [] };
  const scope = { resolveUserDataScope: jest.fn(async () => unrestricted) };
  const audit = new AuditService(prisma);
  const docs = new InventoryDocumentsService(
    prisma,
    new InventoryDocumentsRepository(prisma),
    new InventoryLineResolverService(scope as unknown as DataAccessPoliciesService),
    new StockPostingService(),
    audit,
  );
  const stock = new StockQueryService(prisma, audit, scope as unknown as DataAccessPoliciesService);
  const locationsRepository = new WarehousesRepository(prisma);
  const locations = new WarehousesService(locationsRepository, new BranchesRepository(prisma), audit);
  const bins = new StorageBinsService(new StorageBinsRepository(prisma), locationsRepository, audit);
  const actor = '1';

  const ids: Record<string, string> = {};
  const companies: bigint[] = [];

  async function makeCompany(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { companyCode: `INVT_${tag}_${stamp}`.slice(0, 30), name: `Inventory test ${tag}` },
    });
    companies.push(company.companyId);
    const branch = await prisma.branch.create({
      data: { companyId: company.companyId, branchCode: 'S1', name: 'Site 1' },
    });
    const otherBranch = await prisma.branch.create({
      data: { companyId: company.companyId, branchCode: 'S2', name: 'Site 2' },
    });
    const binned = await prisma.warehouse.create({
      data: { companyId: company.companyId, branchId: branch.branchId, warehouseCode: 'MAIN', name: 'Main store', binManagement: true },
    });
    const plain = await prisma.warehouse.create({
      data: { companyId: company.companyId, branchId: branch.branchId, warehouseCode: 'YARD', name: 'Yard' },
    });
    const bin = await prisma.storageBin.create({
      data: { companyId: company.companyId, warehouseId: binned.warehouseId, binCode: 'A-01' },
    });
    const item = await prisma.item.create({
      data: { companyId: company.companyId, itemCode: 'P-100', description: 'Bearing', inventoryJson: { uomName: 'NOS' } },
    });
    const batchItem = await prisma.item.create({
      data: { companyId: company.companyId, itemCode: 'P-200', description: 'Oil', manageBy: 'batch' },
    });
    const serviceItem = await prisma.item.create({
      data: { companyId: company.companyId, itemCode: 'SVC-1', description: 'Labour', isInventoryItem: false },
    });
    return {
      serviceItemId: serviceItem.itemId.toString(),
      companyId: company.companyId.toString(),
      siteId: branch.branchId.toString(),
      otherSiteId: otherBranch.branchId.toString(),
      binnedId: binned.warehouseId.toString(),
      plainId: plain.warehouseId.toString(),
      binId: bin.storageBinId.toString(),
      itemId: item.itemId.toString(),
      batchItemId: batchItem.itemId.toString(),
    };
  }

  let a: Awaited<ReturnType<typeof makeCompany>>;
  let b: Awaited<ReturnType<typeof makeCompany>>;

  const binLine = (extra: Record<string, unknown>) => ({
    itemId: a.itemId,
    siteId: a.siteId,
    inventoryLocationId: a.binnedId,
    storageBinId: a.binId,
    ...extra,
  });

  const expectCode = async (promise: Promise<unknown>, code: string, status = 400) => {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).getStatus()).toBe(status);
    expect((err as BusinessException).getResponse()).toMatchObject({ code });
  };

  const balance = async (companyId: string, warehouseId: string, binId: string | null) => {
    const row = await prisma.stockBalance.findFirst({
      where: {
        companyId: BigInt(companyId),
        itemId: BigInt(a.itemId),
        warehouseId: BigInt(warehouseId),
        binKey: binId ? BigInt(binId) : 0n,
      },
    });
    return row ? row.quantity.toString() : null;
  };

  beforeAll(async () => {
    a = await makeCompany('A');
    b = await makeCompany('B');
  });

  afterAll(async () => {
    for (const companyId of companies) {
      await prisma.stockLedgerEntry.deleteMany({ where: { companyId } });
      await prisma.stockBalance.deleteMany({ where: { companyId } });
      await prisma.inventoryDocument.deleteMany({ where: { companyId } });
      await prisma.userAudit.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { companyId } });
    }
    await prisma.$disconnect();
  });

  it('opening stock: draft changes nothing, post writes ledger IN + balance once', async () => {
    const draft: Doc = await docs.create(
      OPENING_STOCK,
      a.companyId,
      { documentDate: '2026-10-01', lines: [binLine({ quantity: '90', unitPrice: '12.5' })] },
      actor,
    );
    expect(draft).toMatchObject({ documentNumber: 'OS-000001', status: 'DRAFT' });
    expect(await balance(a.companyId, a.binnedId, a.binId)).toBeNull();

    const edited: Doc = await docs.update(
      OPENING_STOCK,
      a.companyId,
      draft.documentId,
      { documentDate: '2026-10-01', lines: [binLine({ quantity: '100', unitPrice: '12.5', uom: 'nos' })] },
      actor,
    );
    expect(edited.lines[0]).toMatchObject({ quantity: '100', partNumber: 'P-100', uom: 'NOS', siteId: a.siteId });

    const posted: Doc = await docs.post(OPENING_STOCK, a.companyId, draft.documentId, actor);
    expect(posted).toMatchObject({ status: 'POSTED', postedBy: actor });
    expect(await balance(a.companyId, a.binnedId, a.binId)).toBe('100');

    const ledger = await prisma.stockLedgerEntry.findMany({ where: { documentId: BigInt(draft.documentId) } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ movementType: 'OPENING_STOCK', documentNumber: 'OS-000001' });
    expect(ledger[0].qtyIn.toString()).toBe('100');
    expect(ledger[0].totalValue?.toString()).toBe('1250');

    const iws = await prisma.itemWarehouseStock.findFirst({
      where: { itemId: BigInt(a.itemId), warehouseId: BigInt(a.binnedId) },
    });
    expect(iws?.qtyOnHand.toString()).toBe('100');

    await expectCode(docs.post(OPENING_STOCK, a.companyId, draft.documentId, actor), 'INVENTORY_DOCUMENT_ALREADY_POSTED', 409);
    await expectCode(
      docs.update(OPENING_STOCK, a.companyId, draft.documentId, { documentDate: '2026-10-01', lines: [binLine({ quantity: '1' })] }, actor),
      'INVENTORY_DOCUMENT_POSTED',
      409,
    );
    await expectCode(docs.remove(OPENING_STOCK, a.companyId, draft.documentId, actor), 'INVENTORY_DOCUMENT_POSTED', 409);
    expect(await prisma.stockLedgerEntry.count({ where: { documentId: BigInt(draft.documentId) } })).toBe(1);
  });

  it('validates hierarchy, bins, batch items, UoM and other-company masters', async () => {
    const create = (line: Record<string, unknown>) =>
      docs.create(OPENING_STOCK, a.companyId, { documentDate: '2026-10-01', lines: [line as never] }, actor);

    await expectCode(create(binLine({ quantity: '1', storageBinId: null })), 'INVENTORY_BIN_REQUIRED');
    await expectCode(
      create({ itemId: a.itemId, inventoryLocationId: a.plainId, storageBinId: a.binId, quantity: '1' }),
      'INVENTORY_BIN_NOT_ALLOWED',
    );
    await expectCode(create(binLine({ quantity: '1', siteId: a.otherSiteId })), 'INVENTORY_SITE_LOCATION_MISMATCH');
    await expectCode(create(binLine({ quantity: '1', itemId: a.batchItemId })), 'INVENTORY_ITEM_BATCH_SERIAL_NOT_SUPPORTED');
    await expectCode(create(binLine({ quantity: '1', itemId: a.serviceItemId })), 'INVENTORY_ITEM_NOT_STOCKABLE');
    await expectCode(create(binLine({ quantity: '1', uom: 'KG' })), 'INVENTORY_UOM_MISMATCH');
    await expectCode(create(binLine({ quantity: '1', itemId: b.itemId })), 'INVENTORY_ITEM_NOT_FOUND');
    await expectCode(
      create({ itemId: a.itemId, inventoryLocationId: b.plainId, quantity: '1' }),
      'INVENTORY_LOCATION_NOT_FOUND',
    );
  });

  it('material issue: shows available stock, posts OUT, rejects insufficient stock atomically', async () => {
    const issue = (quantity: string, date = '2026-10-03') =>
      docs.create(
        MATERIAL_ISSUE,
        a.companyId,
        { documentDate: date, requestedBy: 'Line 2', issuedBy: 'Store', purpose: 'Maintenance', lines: [binLine({ quantity })] },
        actor,
      ) as Promise<Doc>;

    const ok = await issue('30');
    expect(ok.lines[0]).toMatchObject({ availableQuantity: '100', quantity: '30' });
    expect(ok).toMatchObject({ requestedBy: 'Line 2', documentNumber: 'MI-000001' });
    await docs.post(MATERIAL_ISSUE, a.companyId, ok.documentId, actor);
    expect(await balance(a.companyId, a.binnedId, a.binId)).toBe('70');

    const tooMuch = await issue('80');
    await expectCode(docs.post(MATERIAL_ISSUE, a.companyId, tooMuch.documentId, actor), 'INSUFFICIENT_STOCK');
    const after: Doc = await docs.findOne(MATERIAL_ISSUE, a.companyId, tooMuch.documentId);
    expect(after.status).toBe('DRAFT');
    expect(await prisma.stockLedgerEntry.count({ where: { documentId: BigInt(tooMuch.documentId) } })).toBe(0);
    expect(await balance(a.companyId, a.binnedId, a.binId)).toBe('70');
    await docs.remove(MATERIAL_ISSUE, a.companyId, tooMuch.documentId, actor);
  });

  it('concurrent issues cannot oversell', async () => {
    const make = () =>
      docs.create(
        MATERIAL_ISSUE,
        a.companyId,
        { documentDate: '2026-10-04', requestedBy: 'Line 3', lines: [binLine({ quantity: '40' })] },
        actor,
      ) as Promise<Doc>;
    const [first, second] = await Promise.all([make(), make()]);
    expect(first.documentNumber).not.toBe(second.documentNumber);

    const results = await Promise.allSettled([
      docs.post(MATERIAL_ISSUE, a.companyId, first.documentId, actor),
      docs.post(MATERIAL_ISSUE, a.companyId, second.documentId, actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as BusinessException).getResponse()).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await balance(a.companyId, a.binnedId, a.binId)).toBe('30');

    const loser = results[0].status === 'rejected' ? first : second;
    await docs.remove(MATERIAL_ISSUE, a.companyId, loser.documentId, actor);
  });

  it('concurrent double post of the same document posts once', async () => {
    const doc = (await docs.create(
      OPENING_STOCK,
      a.companyId,
      { documentDate: '2026-10-04', lines: [{ itemId: a.itemId, inventoryLocationId: a.plainId, quantity: '5' }] },
      actor,
    )) as Doc;
    const results = await Promise.allSettled([
      docs.post(OPENING_STOCK, a.companyId, doc.documentId, actor),
      docs.post(OPENING_STOCK, a.companyId, doc.documentId, actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.stockLedgerEntry.count({ where: { documentId: BigInt(doc.documentId) } })).toBe(1);
    expect(await balance(a.companyId, a.plainId, null)).toBe('5');
  });

  it('stock adjustment: difference is re-read from stock at posting (IN and OUT)', async () => {
    const adjust = (physicalQuantity: string, date: string) =>
      docs.create(
        STOCK_ADJUSTMENT,
        a.companyId,
        { documentDate: date, reason: 'Cycle count', lines: [binLine({ physicalQuantity })] },
        actor,
      ) as Promise<Doc>;

    const up = await adjust('33', '2026-10-05');
    expect(up.lines[0]).toMatchObject({ systemQuantity: '30', difference: '3', adjustmentType: 'IN' });
    await docs.post(STOCK_ADJUSTMENT, a.companyId, up.documentId, actor);
    expect(await balance(a.companyId, a.binnedId, a.binId)).toBe('33');

    // Draft says 33 → 25 (OUT 8); stock moves to 28 before posting, so posting must give OUT 3.
    const down = await adjust('25', '2026-10-06');
    expect(down.lines[0]).toMatchObject({ difference: '-8', adjustmentType: 'OUT' });
    const issue = (await docs.create(
      MATERIAL_ISSUE,
      a.companyId,
      { documentDate: '2026-10-06', requestedBy: 'Line 4', lines: [binLine({ quantity: '5' })] },
      actor,
    )) as Doc;
    await docs.post(MATERIAL_ISSUE, a.companyId, issue.documentId, actor);

    const posted: Doc = await docs.post(STOCK_ADJUSTMENT, a.companyId, down.documentId, actor);
    expect(posted.lines[0]).toMatchObject({ systemQuantity: '28', difference: '-3', adjustmentType: 'OUT' });
    expect(await balance(a.companyId, a.binnedId, a.binId)).toBe('25');

    await expectCode(
      docs.create(
        STOCK_ADJUSTMENT,
        a.companyId,
        { documentDate: '2026-10-07', reason: 'x', lines: [binLine({ physicalQuantity: '1' }), binLine({ physicalQuantity: '2' })] },
        actor,
      ),
      'INVENTORY_DUPLICATE_LINE',
    );
  });

  it('ledger: running balance includes earlier movements and survives filters', async () => {
    const all: Doc = await stock.ledger(a.companyId, actor, {
      itemId: a.itemId,
      inventoryLocationId: a.binnedId,
      page: 1,
      limit: 50,
    } as never);
    const flow = all.items.map((r: Doc) => [r.transactionType, r.quantityIn, r.quantityOut, r.runningBalance]);
    expect(flow).toEqual([
      ['OPENING_STOCK', '100', '0', '100'],
      ['MATERIAL_ISSUE', '0', '30', '70'],
      ['MATERIAL_ISSUE', '0', '40', '30'],
      ['ADJUSTMENT_IN', '3', '0', '33'],
      ['MATERIAL_ISSUE', '0', '5', '28'],
      ['ADJUSTMENT_OUT', '0', '3', '25'],
    ]);
    expect(all.items[0]).toMatchObject({ partNumber: 'P-100', siteName: 'Site 1', binCode: 'A-01', uom: 'NOS' });

    const fromOct5: Doc = await stock.ledger(a.companyId, actor, {
      itemId: a.itemId,
      inventoryLocationId: a.binnedId,
      fromDate: '2026-10-05',
      page: 1,
      limit: 50,
    } as never);
    expect(fromOct5.openingBalance).toBe('30');
    expect(fromOct5.items.map((r: Doc) => r.runningBalance)).toEqual(['33', '28', '25']);

    const issuesOnly: Doc = await stock.ledger(a.companyId, actor, {
      itemId: a.itemId,
      inventoryLocationId: a.binnedId,
      movementType: ['MATERIAL_ISSUE'],
      page: 1,
      limit: 2,
    } as never);
    expect(issuesOnly.total).toBe(3);
    expect(issuesOnly.items.map((r: Doc) => r.runningBalance)).toEqual(['70', '30']);
  });

  it('current stock lists balances per location; other companies see nothing', async () => {
    const current: Doc = await stock.currentStock(a.companyId, actor, { page: 1, limit: 20 } as never);
    const rows = current.items.map((r: Doc) => [r.partNumber, r.locationCode, r.binCode, r.quantity]);
    expect(rows).toEqual([
      ['P-100', 'MAIN', 'A-01', '25'],
      ['P-100', 'YARD', null, '5'],
    ]);

    const otherCompany: Doc = await stock.currentStock(b.companyId, actor, { page: 1, limit: 20 } as never);
    expect(otherCompany.items).toHaveLength(0);
    const otherLedger: Doc = await stock.ledger(b.companyId, actor, { page: 1, limit: 20 } as never);
    expect(otherLedger.total).toBe(0);

    const draft = (await docs.create(
      OPENING_STOCK,
      a.companyId,
      { documentDate: '2026-10-08', lines: [binLine({ quantity: '1' })] },
      actor,
    )) as Doc;
    const notFound = { status: 404 };
    await expect(docs.findOne(OPENING_STOCK, b.companyId, draft.documentId)).rejects.toMatchObject(notFound);
    await expect(docs.post(OPENING_STOCK, b.companyId, draft.documentId, actor)).rejects.toMatchObject(notFound);
    await expect(docs.remove(OPENING_STOCK, b.companyId, draft.documentId, actor)).rejects.toMatchObject(notFound);
    const listB: Doc = await docs.list(OPENING_STOCK, b.companyId, { page: 1, limit: 20 } as never);
    expect(listB.total).toBe(0);
    await docs.remove(OPENING_STOCK, a.companyId, draft.documentId, actor);
  });

  it('restricted users only see warehouses in their data access policy', async () => {
    scope.resolveUserDataScope.mockResolvedValueOnce({
      isRestricted: true,
      branchIds: [],
      departmentIds: [],
      warehouseIds: [a.plainId],
    } as never);
    const current: Doc = await stock.currentStock(a.companyId, actor, { page: 1, limit: 20 } as never);
    expect(current.items.map((r: Doc) => r.locationCode)).toEqual(['YARD']);
  });

  it('locations and bins with stock cannot be deleted, moved or re-categorised', async () => {
    const category = await prisma.storeCategory.create({
      data: { companyId: BigInt(a.companyId), name: 'Spares Store', codePrefix: 'SPR' },
    });
    const categoryId = category.storeCategoryId.toString();

    await expectCode(locations.remove(a.binnedId, a.companyId, actor), 'LOCATION_HAS_BINS');
    await expectCode(locations.remove(a.plainId, a.companyId, actor), 'LOCATION_IN_USE', 409);
    await expectCode(locations.update(a.plainId, a.companyId, { branchId: a.otherSiteId } as never, actor), 'LOCATION_SITE_LOCKED');
    await expectCode(locations.update(a.plainId, a.companyId, { storeCategoryId: categoryId } as never, actor), 'LOCATION_CATEGORY_LOCKED');
    await expectCode(locations.update(a.plainId, a.companyId, { binManagement: true } as never, actor), 'LOCATION_HAS_UNBINNED_STOCK');
    await expectCode(locations.update(a.binnedId, a.companyId, { binManagement: false } as never, actor), 'LOCATION_HAS_BINS');
    await expectCode(bins.remove(a.binId, a.companyId, actor), 'BIN_IN_USE', 409);

    const renamed: Doc = await locations.update(a.plainId, a.companyId, { name: 'Yard - renamed' } as never, actor);
    expect(renamed).toMatchObject({ name: 'Yard - renamed', locationCode: 'YARD' });
  });

  it('inactive locations and bins are rejected with their own codes', async () => {
    const create = (line: Record<string, unknown>) =>
      docs.create(OPENING_STOCK, a.companyId, { documentDate: '2026-10-09', lines: [line as never] }, actor);

    await bins.update(a.binId, a.companyId, { isActive: false } as never, actor);
    await expectCode(create(binLine({ quantity: '1' })), 'INVENTORY_BIN_INACTIVE');
    await bins.update(a.binId, a.companyId, { isActive: true } as never, actor);

    await locations.update(a.plainId, a.companyId, { isActive: false } as never, actor);
    await expectCode(create({ itemId: a.itemId, inventoryLocationId: a.plainId, quantity: '1' }), 'INVENTORY_LOCATION_INACTIVE');
    await locations.update(a.plainId, a.companyId, { isActive: true } as never, actor);
  });
});
