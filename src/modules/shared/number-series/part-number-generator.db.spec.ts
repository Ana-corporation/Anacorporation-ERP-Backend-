/**
 * Real-database test of part-number generation: atomic counter under parallel saves, stores
 * independent, lock flags, missing / inactive series. Creates throw-away companies and deletes them.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest part-number-generator.db --runInBand
 */
import { Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NUMBER_SERIES_ERROR_CODES } from './number-series.constants';
import { PartNumberGeneratorService } from './part-number-generator.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Number series DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

const TX_OPTIONS = { maxWait: 60_000, timeout: 60_000 };

run('Part number generator (database)', () => {
  jest.setTimeout(180_000);

  const prisma = new PrismaService();
  const generator = new PartNumberGeneratorService();
  const companies: bigint[] = [];

  async function makeCompany(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { companyCode: `NSRT_${tag}_${stamp}`.slice(0, 30), name: `Number series test ${tag}` },
    });
    companies.push(company.companyId);
    const category = (name: string, codePrefix: string) =>
      prisma.storeCategory.create({ data: { companyId: company.companyId, name, codePrefix } });
    const [bo, fg, el] = await Promise.all([
      category('Bought-Out Store', 'BOS'),
      category('Finished Goods Store', 'FGS'),
      category('Electrical Store', 'ELS'),
    ]);
    return { companyId: company.companyId, bo: bo.storeCategoryId, fg: fg.storeCategoryId, el: el.storeCategoryId };
  }

  async function makeSeries(companyId: bigint, lines: { ref: bigint; code: string; length: number }[]) {
    return prisma.numberSeriesConfig.create({
      data: {
        companyId,
        documentType: 'ITEM',
        prefix: 'ANA',
        segmentSource: 'STORE',
        separator: 'NONE',
        serialLengthDefault: 5,
        lines: {
          create: lines.map((l) => ({
            companyId,
            segmentRefId: l.ref,
            segmentCode: l.code,
            serialLength: l.length,
          })),
        },
      },
    });
  }

  /** Same shape as the item create: generate + insert in one transaction. */
  function createItem(companyId: bigint, storeCategoryId: bigint | null) {
    return prisma.$transaction(async (db) => {
      const tx = db as unknown as Prisma.TransactionClient;
      const itemCode = await generator.generatePartNumber(tx, companyId, { storeCategoryId });
      await tx.item.create({ data: { companyId, itemCode, description: `Part ${itemCode}`, storeCategoryId } });
      return itemCode;
    }, TX_OPTIONS);
  }

  async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof BusinessException) return (e.getResponse() as { code?: string }).code;
      throw e;
    }
    return undefined;
  }

  let a: Awaited<ReturnType<typeof makeCompany>>;
  let b: Awaited<ReturnType<typeof makeCompany>>;

  beforeAll(async () => {
    a = await makeCompany('A');
    b = await makeCompany('B');
    await makeSeries(a.companyId, [
      { ref: a.bo, code: 'BO', length: 5 },
      { ref: a.fg, code: 'FG', length: 4 },
    ]);
  });

  afterAll(async () => {
    for (const companyId of companies) {
      await prisma.company.delete({ where: { companyId } });
    }
    await prisma.$disconnect();
  });

  it('20 parallel saves on one store get 20 unique, consecutive numbers', async () => {
    const codes = await Promise.all(Array.from({ length: 20 }, () => createItem(a.companyId, a.bo)));
    const expected = Array.from({ length: 20 }, (_, i) => `ANABO${String(i + 1).padStart(5, '0')}`);
    expect([...codes].sort()).toEqual(expected);

    const line = await prisma.numberSeriesLine.findFirstOrThrow({ where: { companyId: a.companyId, segmentRefId: a.bo } });
    expect(line.lastNumber).toBe(20);
  });

  it('stores run independently and use their own serial length', async () => {
    expect(await createItem(a.companyId, a.fg)).toBe('ANAFG0001');
    expect(await createItem(a.companyId, a.bo)).toBe('ANABO00021');
    expect(await createItem(a.companyId, a.fg)).toBe('ANAFG0002');
  });

  it('sets the lock flags after the first number', async () => {
    const config = await prisma.numberSeriesConfig.findFirstOrThrow({ where: { companyId: a.companyId } });
    expect(config.isLocked).toBe(true);
    const lines = await prisma.numberSeriesLine.findMany({ where: { companyId: a.companyId } });
    expect(lines.every((l) => l.isLocked)).toBe(true);
  });

  it('a rolled-back save releases its number', async () => {
    await expect(
      prisma.$transaction(async (db) => {
        await generator.generatePartNumber(db as unknown as Prisma.TransactionClient, a.companyId, { storeCategoryId: a.fg });
        throw new Error('item insert failed');
      }, TX_OPTIONS),
    ).rejects.toThrow('item insert failed');
    expect(await createItem(a.companyId, a.fg)).toBe('ANAFG0003');
  });

  it('skips a code already held by an item', async () => {
    await prisma.item.create({ data: { companyId: a.companyId, itemCode: 'ANAFG0004', description: 'typed by hand' } });
    expect(await createItem(a.companyId, a.fg)).toBe('ANAFG0005');
  });

  it('store without a line, company without a series, inactive series', async () => {
    expect(await errorCode(createItem(a.companyId, a.el))).toBe(NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED);
    expect(await errorCode(createItem(a.companyId, null))).toBe(NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED);
    expect(await errorCode(createItem(b.companyId, b.bo))).toBe(NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED);

    await makeSeries(b.companyId, [{ ref: b.bo, code: 'BO', length: 5 }]);
    await prisma.numberSeriesConfig.updateMany({ where: { companyId: b.companyId }, data: { isActive: false } });
    expect(await errorCode(createItem(b.companyId, b.bo))).toBe(NUMBER_SERIES_ERROR_CODES.INACTIVE);
    expect(await generator.findActiveItemSeries(prisma as unknown as Prisma.TransactionClient, b.companyId)).toBeNull();
  });

  it("does not touch another company's counter", async () => {
    await prisma.numberSeriesConfig.updateMany({ where: { companyId: b.companyId }, data: { isActive: true } });
    expect(await createItem(b.companyId, b.bo)).toBe('ANABO00001');
    expect(await errorCode(createItem(b.companyId, a.bo))).toBe(NUMBER_SERIES_ERROR_CODES.NOT_CONFIGURED);
  });
});
