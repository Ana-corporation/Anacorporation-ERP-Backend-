/**
 * Real-database test of the Number Series settings API and the Item Master integration.
 * Creates throw-away companies and deletes them afterwards.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest number-series.db --runInBand
 */
import { BusinessException } from '@/common/exceptions/business.exception';
import { PERMISSIONS_KEY } from '@/common/constants/metadata.constants';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { ItemsRepository } from '@/modules/inventory/item-master/items.repository';
import { ITEM_ERROR_CODES, ItemsService } from '@/modules/inventory/item-master/items.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { DocumentNumberService } from './document-number.service';
import { NUMBER_SERIES_ERROR_CODES } from './number-series.constants';
import { NumberSeriesController } from './number-series.controller';
import { NumberSeriesRepository } from './number-series.repository';
import { NumberSeriesService } from './number-series.service';
import { PartNumberGeneratorService } from './part-number-generator.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Number series DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Body = Parameters<NumberSeriesService['update']>[2];
type View = Awaited<ReturnType<NumberSeriesService['get']>>;

describe('NumberSeriesController permissions', () => {
  it('needs number_series:view to read and number_series:edit to save', () => {
    const proto = NumberSeriesController.prototype as unknown as Record<string, object>;
    const permissions = (name: string) => Reflect.getMetadata(PERMISSIONS_KEY, proto[name]);
    expect(permissions('list')).toEqual(['number_series:view']);
    expect(permissions('get')).toEqual(['number_series:view']);
    expect(permissions('preview')).toEqual(['number_series:view']);
    expect(permissions('audit')).toEqual(['number_series:view']);
    expect(permissions('update')).toEqual(['number_series:edit']);
  });
});

run('Number series settings + items (database)', () => {
  jest.setTimeout(180_000);

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const generator = new PartNumberGeneratorService();
  const series = new NumberSeriesService(
    new NumberSeriesRepository(prisma),
    audit,
    generator,
    new DocumentNumberService(prisma),
  );
  const customFields = {
    persistCustomFields: jest.fn(async () => undefined),
    mergeEntityWithCustomFields: jest.fn(async (_c: string, _e: string, _id: string, row: unknown) => row),
  };
  const items = new ItemsService(
    new ItemsRepository(prisma),
    audit,
    {} as DataAccessPoliciesService,
    {} as StorageService,
    customFields as unknown as CustomFieldsValuesService,
    generator,
    { loadFieldOverrides: jest.fn(async () => ({ visibility: new Map(), registration: new Map(), order: new Map() })) } as never,
  );
  const companies: bigint[] = [];
  const actor = undefined;

  async function makeCompany(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { companyCode: `NSST_${tag}_${stamp}`.slice(0, 30), name: `Number series settings ${tag}` },
    });
    companies.push(company.companyId);
    const category = (name: string, codePrefix: string, sortOrder: number) =>
      prisma.storeCategory.create({ data: { companyId: company.companyId, name, codePrefix, sortOrder } });
    const bo = await category('Bought-Out Store', 'BOS', 1);
    const fg = await category('Finished Goods Store', 'FGS', 2);
    const el = await category('Electrical Store', 'ELS', 3);
    return {
      companyId: company.companyId.toString(),
      bo: bo.storeCategoryId.toString(),
      fg: fg.storeCategoryId.toString(),
      el: el.storeCategoryId.toString(),
    };
  }

  const anaBody = (c: { bo: string; fg: string }, extra: Partial<Body['config']> = {}): Body => ({
    config: {
      prefix: 'ana',
      segmentSource: 'STORE',
      separator: 'NONE',
      serialLengthDefault: 5,
      serialReset: 'NEVER',
      isActive: true,
      ...extra,
    },
    lines: [
      { segmentRefId: c.bo, segmentCode: 'bo', startFrom: 1 },
      { segmentRefId: c.fg, segmentCode: 'FG', startFrom: 1, serialLength: 4 },
    ],
  });

  async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof BusinessException) return (e.getResponse() as { code?: string }).code;
      throw e;
    }
    return undefined;
  }

  const line = (view: View, segmentRefId: string) => view.lines.find((l) => String(l.segmentRefId) === segmentRefId)!;

  let a: Awaited<ReturnType<typeof makeCompany>>;
  let plain: Awaited<ReturnType<typeof makeCompany>>;

  beforeAll(async () => {
    a = await makeCompany('A');
    plain = await makeCompany('P');
  });

  afterAll(async () => {
    for (const companyId of companies) {
      await prisma.userAudit.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { companyId } });
    }
    await prisma.$disconnect();
  });

  it('GET before setup: no config, one empty line per active store', async () => {
    const view = await series.get(a.companyId, 'item');
    expect(view.config).toBeNull();
    expect(view.lines.map((l) => l.segmentName)).toEqual(['Bought-Out Store', 'Finished Goods Store', 'Electrical Store']);
    expect(line(view, a.bo)).toMatchObject({ numberSeriesLineId: null, segmentCode: '', nextNumber: '' });
    expect(await series.list(a.companyId)).toEqual([
      { documentType: 'ITEM', label: 'Item / Part Number', configured: false, isActive: false, isLocked: false },
    ]);
  });

  it('rejects YEARLY, bad prefix / code / length', async () => {
    expect(await errorCode(series.update(a.companyId, 'ITEM', anaBody(a, { serialReset: 'YEARLY' }), actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.RESET_UNSUPPORTED,
    );
    expect(await errorCode(series.update(a.companyId, 'ITEM', anaBody(a, { prefix: 'AN-A' }), actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.PREFIX_INVALID,
    );
    expect(await errorCode(series.update(a.companyId, 'ITEM', anaBody(a, { serialLengthDefault: 9 }), actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.SERIAL_LENGTH_INVALID,
    );
    const badCode = anaBody(a);
    badCode.lines[0].segmentCode = 'B-O';
    expect(await errorCode(series.update(a.companyId, 'ITEM', badCode, actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_INVALID,
    );
    const duplicate = anaBody(a);
    duplicate.lines[1].segmentCode = 'BO';
    expect(await errorCode(series.update(a.companyId, 'ITEM', duplicate, actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.SEGMENT_CODE_EXISTS,
    );
    const foreign = anaBody(a);
    foreign.lines[0].segmentRefId = plain.bo;
    expect(await errorCode(series.update(a.companyId, 'ITEM', foreign, actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED,
    );
    expect(await prisma.numberSeriesConfig.count({ where: { companyId: BigInt(a.companyId) } })).toBe(0);
  });

  it('PUT saves config + lines, writes the store code, previews the next number', async () => {
    const view = await series.update(a.companyId, 'ITEM', anaBody(a), actor);
    expect(view.config).toMatchObject({ prefix: 'ANA', segmentSource: 'STORE', isLocked: false, rowVersion: 1 });
    expect(line(view, a.bo)).toMatchObject({ segmentCode: 'BO', serialLength: 5, nextNumber: 'ANABO00001' });
    expect(line(view, a.fg)).toMatchObject({ segmentCode: 'FG', serialLength: 4, nextNumber: 'ANAFG0001' });
    expect(line(view, a.el)).toMatchObject({ numberSeriesLineId: null, nextNumber: '' });

    const bo = await prisma.storeCategory.findUniqueOrThrow({ where: { storeCategoryId: BigInt(a.bo) } });
    expect(bo.numberSeriesCode).toBe('BO');
    expect(await series.preview(a.companyId, 'ITEM', a.fg)).toEqual({ segmentRefId: a.fg, nextNumber: 'ANAFG0001' });

    const auditLog = await series.auditLog(a.companyId, { page: 1, limit: 50 });
    expect(auditLog.total).toBeGreaterThan(0);
    expect(auditLog.items.some((r) => r.field === 'prefix' && r.newValue === 'ANA')).toBe(true);
    expect(auditLog.items.some((r) => r.field === 'segmentCode' && r.segmentName === 'Bought-Out Store')).toBe(true);
  });

  it('items: store required, ANABO00001 → ANABO00002, ANAFG0001, client code ignored', async () => {
    expect(await errorCode(items.create(a.companyId, { description: 'No store' } as never, '1'))).toBe(
      ITEM_ERROR_CODES.STORE_REQUIRED,
    );
    const first = await items.create(a.companyId, { description: 'Bearing', storeCategoryId: a.bo, itemCode: 'MY-CODE' } as never, '1');
    const second = await items.create(a.companyId, { description: 'Seal', storeCategoryId: a.bo } as never, '1');
    const fg = await items.create(a.companyId, { description: 'Pump', storeCategoryId: a.fg } as never, '1');
    expect([first.itemCode, second.itemCode, fg.itemCode]).toEqual(['ANABO00001', 'ANABO00002', 'ANAFG0001']);
    expect(first).toMatchObject({
      storeCategoryId: a.bo,
      storeCategory: { storeCategoryId: a.bo, name: 'Bought-Out Store', numberSeriesCode: 'BO' },
    });
    expect((await items.getItemSettings(a.companyId)).numberSeriesActive).toBe(true);

    expect(
      await errorCode(items.update(String(first.itemId), a.companyId, { storeCategoryId: a.fg } as never, '1')),
    ).toBe(ITEM_ERROR_CODES.STORE_LOCKED);
    await expect(
      items.update(String(first.itemId), a.companyId, { storeCategoryId: a.bo, description: 'Bearing 6204' } as never, '1'),
    ).resolves.toMatchObject({ itemCode: 'ANABO00001', description: 'Bearing 6204' });
  });

  it('after the first number: structure locked, startFrom rules, new stores can still be added', async () => {
    const view = await series.get(a.companyId, 'ITEM');
    expect(view.config?.isLocked).toBe(true);
    expect(view.lockedFields).toEqual(['prefix', 'segmentSource', 'separator', 'serialLengthDefault']);
    expect(line(view, a.bo)).toMatchObject({ lastNumber: 2, isLocked: true, nextNumber: 'ANABO00003' });

    expect(await errorCode(series.update(a.companyId, 'ITEM', anaBody(a, { prefix: 'ANX' }), actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.LOCKED_FIELD,
    );
    const newLength = anaBody(a);
    newLength.lines[0].serialLength = 6;
    expect(await errorCode(series.update(a.companyId, 'ITEM', newLength, actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.LOCKED_FIELD,
    );
    const tooLow = anaBody(a);
    tooLow.lines[0].startFrom = 2;
    expect(await errorCode(series.update(a.companyId, 'ITEM', tooLow, actor))).toBe(
      NUMBER_SERIES_ERROR_CODES.START_FROM_TOO_LOW,
    );

    const jump = anaBody(a);
    jump.lines[0].startFrom = 100;
    jump.lines.push({ segmentRefId: a.el, segmentCode: 'EL', startFrom: 1 });
    const saved = await series.update(a.companyId, 'ITEM', jump, actor);
    expect(line(saved, a.bo).nextNumber).toBe('ANABO00100');
    expect(line(saved, a.el).nextNumber).toBe('ANAEL00001');
    expect(line(saved, a.fg)).toMatchObject({ startFrom: 1, nextNumber: 'ANAFG0002' });

    const next = await items.create(a.companyId, { description: 'Gasket', storeCategoryId: a.bo } as never, '1');
    expect(next.itemCode).toBe('ANABO00100');
  });

  it('stale rowVersion → NUMBER_SERIES_CONFLICT', async () => {
    const view = await series.get(a.companyId, 'ITEM');
    const stale = anaBody(a, { isActive: true, rowVersion: (view.config!.rowVersion as number) - 1 });
    expect(await errorCode(series.update(a.companyId, 'ITEM', stale, actor))).toBe(NUMBER_SERIES_ERROR_CODES.CONFLICT);
  });

  it('inactive series → items fall back to ITM-######; company without a series too', async () => {
    const view = await series.get(a.companyId, 'ITEM');
    const off = anaBody(a, { isActive: false, rowVersion: view.config!.rowVersion as number });
    off.lines[0].startFrom = 100;
    await series.update(a.companyId, 'ITEM', off, actor);
    expect((await items.getItemSettings(a.companyId)).numberSeriesActive).toBe(false);
    const fallback = await items.create(a.companyId, { description: 'Old style' } as never, '1');
    expect(fallback.itemCode).toMatch(/^ITM-\d{6}$/);

    const plainItem = await items.create(plain.companyId, { description: 'No series' } as never, '1');
    expect(plainItem.itemCode).toBe('ITM-000001');
    expect((await items.getItemSettings(plain.companyId)).numberSeriesActive).toBe(false);
  });
});
