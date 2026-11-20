/**
 * Real-database test of category-based part numbers (segment source ITEM_GROUP):
 * Category master codes, per-category counters, locks, parallel saves, failed saves.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest category-part-numbers.db --runInBand
 */
import { Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { ITEM_GROUP_ERROR_CODES } from '@/modules/inventory/item-groups/item-groups.constants';
import { ItemGroupsRepository } from '@/modules/inventory/item-groups/item-groups.repository';
import { ItemGroupsService } from '@/modules/inventory/item-groups/item-groups.service';
import { ItemsRepository } from '@/modules/inventory/item-master/items.repository';
import { ITEM_ERROR_CODES, ItemsService } from '@/modules/inventory/item-master/items.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { ImportSessionService } from '@/modules/imports/import-session.service';
import { CsvParserService } from '@/modules/imports/parsers/csv-parser.service';
import { ExcelParserService } from '@/modules/imports/parsers/excel-parser.service';
import { OpeningStockImportService } from '@/modules/inventory/opening-stock-import/opening-stock-import.service';
import { InventoryDocumentsRepository } from '@/modules/inventory/stock/inventory-documents.repository';
import { InventoryDocumentsService } from '@/modules/inventory/stock/inventory-documents.service';
import { InventoryLineResolverService } from '@/modules/inventory/stock/inventory-line-resolver.service';
import { StockPostingService } from '@/modules/inventory/stock/stock-posting.service';
import { SubcontractorLocationService } from '@/modules/inventory/stock/subcontractor-location.service';
import { WarehousesRepository } from '@/modules/organization/warehouses/warehouses.repository';
import { DocumentNumberService } from './document-number.service';
import { NUMBER_SERIES_ERROR_CODES } from './number-series.constants';
import { NumberSeriesRepository } from './number-series.repository';
import { NumberSeriesService } from './number-series.service';
import { PartNumberGeneratorService } from './part-number-generator.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Number series DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Row = Record<string, any>;
const TX = { maxWait: 60_000, timeout: 60_000 };

run('Category-based part numbers (database)', () => {
  jest.setTimeout(240_000);

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const generator = new PartNumberGeneratorService();
  const series = new NumberSeriesService(
    new NumberSeriesRepository(prisma),
    audit,
    generator,
    new DocumentNumberService(prisma),
  );
  const groups = new ItemGroupsService(new ItemGroupsRepository(prisma), audit);
  const items = new ItemsService(
    new ItemsRepository(prisma),
    audit,
    {} as DataAccessPoliciesService,
    {} as StorageService,
    {
      persistCustomFields: jest.fn(async () => undefined),
      mergeEntityWithCustomFields: jest.fn(async (_c: string, _e: string, _id: string, r: unknown) => r),
    } as unknown as CustomFieldsValuesService,
    generator,
    { loadFieldOverrides: jest.fn(async () => ({ visibility: new Map(), registration: new Map(), order: new Map() })) } as never,
  );
  const actor = '1';
  let companyId: string;
  let company: bigint;
  const ids: Record<string, string> = {};

  async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof BusinessException) return (e.getResponse() as { code?: string }).code;
      throw e;
    }
    return undefined;
  }

  const newItem = (description: string, store: string, group?: string) =>
    items.create(companyId, { description, storeCategoryId: store, itemGroupId: group } as never, actor) as Promise<Row>;

  const category = (name: string, store: string, categoryCode?: string, parentId?: string) =>
    groups.create(companyId, { name, storeCategoryId: parentId ? undefined : store, parentId, categoryCode } as never, actor) as Promise<Row>;

  beforeAll(async () => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const c = await prisma.company.create({ data: { companyCode: `CATN_${stamp}`.slice(0, 30), name: 'Category numbering test' } });
    company = c.companyId;
    companyId = company.toString();
    const store = (name: string, codePrefix: string, numberSeriesCode: string) =>
      prisma.storeCategory.create({ data: { companyId: company, name, codePrefix, numberSeriesCode } });
    ids.bo = (await store('Bought-Out Store', 'BOS', 'BO')).storeCategoryId.toString();
    ids.rm = (await store('RM Store', 'RMS', 'RM')).storeCategoryId.toString();

    ids.brg = (await category('Bearings', ids.bo, 'brg')).itemGroupId;
    ids.blt = (await category('Belts', ids.bo, 'BLT')).itemGroupId;
    ids.raw = (await category('Raw Materials', ids.rm, 'RM')).itemGroupId;
    ids.misc = (await category('Misc', ids.bo)).itemGroupId;
    ids.ball = (await category('Ball Bearings', ids.bo, undefined, ids.brg)).itemGroupId;
  });

  afterAll(async () => {
    await prisma.userAudit.deleteMany({ where: { companyId: company } });
    await prisma.company.delete({ where: { companyId: company } });
    await prisma.$disconnect();
  });

  it('category code rules: uppercase, unique per company; sub-group shows the inherited code', async () => {
    expect(await errorCode(category('Bearings 2', ids.rm, 'BRG'))).toBe(ITEM_GROUP_ERROR_CODES.CODE_EXISTS);
    const ball: Row = await groups.findOne(ids.ball, companyId);
    expect(ball).toMatchObject({ categoryCode: null, effectiveCategoryCode: 'BRG', path: 'Bearings / Ball Bearings' });
  });

  it('switching the series to Category builds one line per coded category, code read from the master', async () => {
    const view: Row = await series.update(
      companyId,
      'ITEM',
      {
        config: { prefix: 'ANA', segmentSource: 'ITEM_GROUP', separator: 'NONE', serialLengthDefault: 5, serialReset: 'NEVER', isActive: true },
        lines: [],
      } as never,
      actor,
    );
    expect(view.config).toMatchObject({ segmentSource: 'ITEM_GROUP', isLocked: false });
    expect(view.lines.map((l: Row) => [l.segmentName, l.storeName, l.segmentCode, l.nextNumber])).toEqual([
      ['Belts', 'Bought-Out Store', 'BLT', 'ANABLT00001'],
      ['Bearings', 'Bought-Out Store', 'BRG', 'ANABRG00001'],
      ['Raw Materials', 'RM Store', 'RM', 'ANARM00001'],
    ]);
    expect(await series.preview(companyId, 'ITEM', ids.ball)).toEqual({ segmentRefId: ids.ball, nextNumber: 'ANABRG00001' });
  });

  it('Bearings → ANABRG00001, ANABRG00002; Belts → ANABLT00001; Raw Materials → ANARM00001; sub-group shares BRG', async () => {
    expect((await newItem('Bearing 6204', ids.bo, ids.brg)).itemCode).toBe('ANABRG00001');
    expect((await newItem('Bearing 6205', ids.bo, ids.brg)).itemCode).toBe('ANABRG00002');
    const belt = await newItem('Timing belt', ids.bo, ids.blt);
    ids.beltItem = String(belt.itemId);
    expect(belt.itemCode).toBe('ANABLT00001');
    expect((await newItem('Steel bar', ids.rm, ids.raw)).itemCode).toBe('ANARM00001');
    expect((await newItem('Ball bearing 608', ids.bo, ids.ball)).itemCode).toBe('ANABRG00003');
  });

  it('Store and Category are mandatory; a category without a code blocks save; group of another store is rejected', async () => {
    expect(await errorCode(newItem('No store', undefined as never, ids.brg))).toBe(ITEM_ERROR_CODES.STORE_REQUIRED);
    expect(await errorCode(newItem('No category', ids.bo))).toBe(ITEM_ERROR_CODES.CATEGORY_REQUIRED);
    expect(await errorCode(newItem('Misc thing', ids.bo, ids.misc))).toBe(NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED);
    expect(await errorCode(newItem('Wrong store', ids.rm, ids.brg))).toBe(ITEM_ERROR_CODES.GROUP_STORE_MISMATCH);
  });

  it('20 parallel saves on one category → 20 unique, consecutive numbers', async () => {
    const codes = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        prisma.$transaction(async (db) => {
          const tx = db as unknown as Prisma.TransactionClient;
          const itemCode = await generator.generatePartNumber(tx, company, { itemGroupId: BigInt(ids.blt) });
          await tx.item.create({ data: { companyId: company, itemCode, description: `Belt ${i}`, storeCategoryId: BigInt(ids.bo), itemGroupId: BigInt(ids.blt) } });
          return itemCode;
        }, TX),
      ),
    );
    expect([...codes].sort()).toEqual(Array.from({ length: 20 }, (_, i) => `ANABLT${String(i + 2).padStart(5, '0')}`));
  });

  it('a failed save consumes no number', async () => {
    await expect(
      prisma.$transaction(async (db) => {
        await generator.generatePartNumber(db as unknown as Prisma.TransactionClient, company, { itemGroupId: BigInt(ids.raw) });
        throw new Error('insert failed');
      }, TX),
    ).rejects.toThrow('insert failed');
    expect((await newItem('Aluminium bar', ids.rm, ids.raw)).itemCode).toBe('ANARM00002');
  });

  it('after first save: Store, Category and Part Number cannot change', async () => {
    expect(await errorCode(items.update(ids.beltItem, companyId, { itemGroupId: ids.brg } as never, actor))).toBe(
      ITEM_ERROR_CODES.CATEGORY_LOCKED,
    );
    expect(await errorCode(items.update(ids.beltItem, companyId, { storeCategoryId: ids.rm } as never, actor))).toBe(
      ITEM_ERROR_CODES.STORE_LOCKED,
    );
    const same: Row = await items.update(ids.beltItem, companyId, { itemGroupId: ids.blt, description: 'Timing belt T5' } as never, actor);
    expect(same).toMatchObject({ itemCode: 'ANABLT00001', description: 'Timing belt T5', itemGroupId: ids.blt });
  });

  it('a used category code is locked; a new category after lock gets its own line and counter', async () => {
    expect(await errorCode(groups.update(ids.brg, companyId, { categoryCode: 'BRX' } as never, actor))).toBe(
      ITEM_GROUP_ERROR_CODES.CODE_LOCKED,
    );
    expect((await groups.findOne(ids.brg, companyId)) as Row).toMatchObject({ codeLocked: true });
    await expect(groups.update(ids.brg, companyId, { description: 'Ball and roller bearings' } as never, actor)).resolves.toBeTruthy();

    const pulleys: Row = await category('Pulleys', ids.bo, 'PLY');
    expect((await newItem('HTD pulley', ids.bo, pulleys.itemGroupId)).itemCode).toBe('ANAPLY00001');

    const view: Row = await series.get(companyId, 'ITEM');
    expect(view.config.isLocked).toBe(true);
    expect(view.lines.find((l: Row) => l.segmentCode === 'BRG')).toMatchObject({ lastNumber: 3, isLocked: true, nextNumber: 'ANABRG00004' });
  });

  it('locked series: source / prefix cannot change; start-from only up', async () => {
    const body = (extra: Row = {}, lines: Row[] = []) =>
      ({
        config: { prefix: 'ANA', segmentSource: 'ITEM_GROUP', separator: 'NONE', serialLengthDefault: 5, serialReset: 'NEVER', isActive: true, ...extra },
        lines,
      }) as never;
    expect(await errorCode(series.update(companyId, 'ITEM', body({ segmentSource: 'STORE' }), actor))).toBe(NUMBER_SERIES_ERROR_CODES.LOCKED_FIELD);
    expect(await errorCode(series.update(companyId, 'ITEM', body({}, [{ segmentRefId: ids.brg, startFrom: 2 }]), actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.START_FROM_TOO_LOW,
    );
    const saved: Row = await series.update(companyId, 'ITEM', body({}, [{ segmentRefId: ids.brg, startFrom: 100 }]), actor);
    expect(saved.lines.find((l: Row) => l.segmentCode === 'BRG').nextNumber).toBe('ANABRG00100');
  });

  it('Opening Stock import never creates items: rows without an existing Part Number are Errors and no number is used', async () => {
    const unrestricted = { isRestricted: false, branchIds: [], departmentIds: [], warehouseIds: [] };
    const scope = { resolveUserDataScope: jest.fn(async () => unrestricted) } as unknown as DataAccessPoliciesService;
    const documents = new InventoryDocumentsService(
      prisma,
      new InventoryDocumentsRepository(prisma),
      new InventoryLineResolverService(scope),
      new StockPostingService(),
      audit,
      new SubcontractorLocationService(new WarehousesRepository(prisma)),
    );
    const imports = new OpeningStockImportService(
      prisma,
      new ImportSessionService(prisma, new ExcelParserService(), new CsvParserService()),
      documents,
      audit,
    );
    await prisma.uom.create({ data: { companyId: company, code: 'NOS', name: 'Numbers' } });
    await prisma.warehouse.create({ data: { companyId: company, warehouseCode: 'BOS-001', name: 'BO 1' } });
    const csv = [
      'Category Code,Part Number,Part Name,Inventory UOM,Location Code,Qty,Unit Price',
      'BLT,,Poly V belt,NOS,BOS-001,4,50',
      'BLT,ANABLT99999,Unknown belt,NOS,BOS-001,1,1',
    ].join('\n');
    const buffer = Buffer.from(csv);
    const itemsBefore = await prisma.item.count({ where: { companyId: company } });
    const lineBefore = await prisma.numberSeriesLine.findFirstOrThrow({ where: { companyId: company, segmentRefId: BigInt(ids.blt) } });
    const summary: Row = await imports.upload(
      companyId,
      actor,
      { originalname: 'cat.csv', mimetype: 'text/csv', size: buffer.length, buffer } as Express.Multer.File,
      '2026-10-01',
    );
    expect(summary).toMatchObject({ matchedRows: 0, errorRows: 2, canApprove: false });
    expect(await prisma.item.count({ where: { companyId: company } })).toBe(itemsBefore);
    const lineAfter = await prisma.numberSeriesLine.findFirstOrThrow({ where: { companyId: company, segmentRefId: BigInt(ids.blt) } });
    expect(lineAfter.lastNumber).toBe(lineBefore.lastNumber);

    await prisma.stockLedgerEntry.deleteMany({ where: { companyId: company } });
    await prisma.stockBalance.deleteMany({ where: { companyId: company } });
    await prisma.openingStockImportBatch.deleteMany({ where: { companyId: company } });
    await prisma.inventoryDocument.deleteMany({ where: { companyId: company } });
  });
});
