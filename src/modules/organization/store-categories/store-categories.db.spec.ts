/**
 * Real-database test of company store categories + category-based location codes.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest store-categories.db
 */
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BranchesRepository } from '../branches/branches.repository';
import { CompaniesRepository } from '../companies/companies.repository';
import { WarehousesRepository } from '../warehouses/warehouses.repository';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateStoreCategorySchema } from './dto/store-category.dto';
import { StoreCategoriesRepository } from './store-categories.repository';
import { StoreCategoriesService } from './store-categories.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Store category DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Row = Record<string, any>;

run('Store categories (database)', () => {
  jest.setTimeout(180_000);

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const categories = new StoreCategoriesService(prisma, new StoreCategoriesRepository(prisma), audit);
  const warehouses = new WarehousesService(new WarehousesRepository(prisma), new BranchesRepository(prisma), audit);
  const actor = '1';
  const companies: bigint[] = [];
  let a: { companyId: string; siteId: string };
  let b: { companyId: string; siteId: string };

  async function makeCompany(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await new CompaniesRepository(prisma).create(
      { companyCode: `SCT_${tag}_${stamp}`.slice(0, 30), name: `Store category test ${tag}`, country: 'India' } as never,
      actor,
    );
    companies.push(company.companyId);
    const site = await prisma.branch.create({
      data: { companyId: company.companyId, branchCode: 'MAIN', name: 'Main site' },
    });
    return { companyId: company.companyId.toString(), siteId: site.branchId.toString() };
  }

  const addCategory = (companyId: string, name: string, codePrefix: string, extra: Record<string, unknown> = {}) =>
    categories.create(
      companyId,
      CreateStoreCategorySchema.parse({ name, codePrefix, ...extra }) as never,
      actor,
    ) as Promise<Row>;

  const addLocation = (companyId: string, siteId: string, name: string, storeCategoryId?: string) =>
    warehouses.create(companyId, { name, branchId: siteId, storeCategoryId } as never, actor) as Promise<Row>;

  beforeAll(async () => {
    a = await makeCompany('A');
    b = await makeCompany('B');
  });

  afterAll(async () => {
    for (const companyId of companies) {
      await prisma.userAudit.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { companyId } });
    }
    await prisma.$disconnect();
  });

  it('new company gets one default General Store / GEN', async () => {
    const list: Row = await categories.findAll(a.companyId);
    expect(list.items.map((c: Row) => [c.name, c.codePrefix, c.locationCount])).toEqual([['General Store', 'GEN', 0]]);
  });

  it('prefix is trimmed + uppercased; duplicate prefix / name rejected', async () => {
    const rms = await addCategory(a.companyId, 'Raw Material Store', 'rms ', { sortOrder: 2 });
    expect(rms).toMatchObject({ codePrefix: 'RMS', isActive: true, locationCount: 0, companyId: a.companyId });

    await expect(addCategory(a.companyId, 'Another', 'RMS')).rejects.toMatchObject({
      response: { code: 'STORE_CATEGORY_PREFIX_EXISTS' },
    });
    await expect(addCategory(a.companyId, 'raw material STORE', 'RAW')).rejects.toMatchObject({
      response: { code: 'STORE_CATEGORY_NAME_EXISTS' },
    });
    expect(CreateStoreCategorySchema.safeParse({ name: 'x', codePrefix: '1AB' }).success).toBe(false);
    expect(CreateStoreCategorySchema.safeParse({ name: 'x', codePrefix: 'TOOLONG' }).success).toBe(false);
  });

  it('locations get <prefix>-NNN per company; another company starts at RMS-001', async () => {
    const rmsA = (await categories.findAll(a.companyId)).items.find((c: Row) => c.codePrefix === 'RMS') as Row;
    const first = await addLocation(a.companyId, a.siteId, 'RM Main', rmsA.storeCategoryId);
    const second = await addLocation(a.companyId, a.siteId, 'RM Assembly', rmsA.storeCategoryId);
    expect([first.locationCode, second.locationCode]).toEqual(['RMS-001', 'RMS-002']);
    expect(first.storeCategory).toEqual({ storeCategoryId: rmsA.storeCategoryId, name: 'Raw Material Store', codePrefix: 'RMS' });

    const rmsB = await addCategory(b.companyId, 'Raw Material Store', 'RMS');
    const otherCompany = await addLocation(b.companyId, b.siteId, 'RM Main', rmsB.storeCategoryId);
    expect(otherCompany.locationCode).toBe('RMS-001');

    const noCategory = await addLocation(a.companyId, a.siteId, 'Plain store');
    expect(noCategory).toMatchObject({ locationCode: 'GEN-001', storeCategoryId: null, storeCategory: null });

    const listed: Row = await categories.findOne(rmsA.storeCategoryId, a.companyId);
    expect(listed.locationCount).toBe(2);
  });

  it('changing a location category keeps its code', async () => {
    const all = (await categories.findAll(a.companyId)).items as Row[];
    const gen = all.find((c) => c.codePrefix === 'GEN')!;
    const location = (await warehouses.findAll(a.companyId, { page: 1, limit: 50 } as never)).items.find(
      (w: Row) => w.locationCode === 'RMS-001',
    ) as Row;
    const updated: Row = await warehouses.update(location.warehouseId, a.companyId, { storeCategoryId: gen.storeCategoryId } as never, actor);
    expect(updated).toMatchObject({ locationCode: 'RMS-001', storeCategoryId: gen.storeCategoryId });
    expect(updated.storeCategory.codePrefix).toBe('GEN');
  });

  it('prefix locked and delete blocked while locations use the category', async () => {
    const rms = ((await categories.findAll(a.companyId)).items as Row[]).find((c) => c.codePrefix === 'RMS')!;
    await expect(categories.update(rms.storeCategoryId, a.companyId, { codePrefix: 'RMX' } as never, actor)).rejects.toMatchObject({
      response: { code: 'STORE_CATEGORY_PREFIX_LOCKED' },
      status: 400,
    });
    await expect(categories.remove(rms.storeCategoryId, a.companyId, actor)).rejects.toMatchObject({
      response: { code: 'STORE_CATEGORY_IN_USE' },
      status: 409,
    });
    const renamed: Row = await categories.update(rms.storeCategoryId, a.companyId, { name: 'Raw Materials' } as never, actor);
    expect(renamed).toMatchObject({ name: 'Raw Materials', codePrefix: 'RMS' });

    const unused = await addCategory(a.companyId, 'Oil Store', 'OIL');
    const changed: Row = await categories.update(unused.storeCategoryId, a.companyId, { codePrefix: 'OIS' } as never, actor);
    expect(changed.codePrefix).toBe('OIS');
    await categories.remove(unused.storeCategoryId, a.companyId, actor);
    await expect(categories.findOne(unused.storeCategoryId, a.companyId)).rejects.toMatchObject({ status: 404 });
    const again = await addCategory(a.companyId, 'Oil Store', 'OIS');
    expect(again.codePrefix).toBe('OIS');
  });

  it('inactive category: rejected for new locations, kept on existing ones', async () => {
    const spr = await addCategory(a.companyId, 'Spares Store', 'SPR');
    const existing = await addLocation(a.companyId, a.siteId, 'Spares Main', spr.storeCategoryId);
    await categories.update(spr.storeCategoryId, a.companyId, { isActive: false } as never, actor);

    await expect(addLocation(a.companyId, a.siteId, 'Spares 2', spr.storeCategoryId)).rejects.toMatchObject({
      response: { code: 'STORE_CATEGORY_INACTIVE' },
      status: 400,
    });
    const kept: Row = await warehouses.update(existing.warehouseId, a.companyId, { name: 'Spares Main (old)', storeCategoryId: spr.storeCategoryId } as never, actor);
    expect(kept).toMatchObject({ locationCode: 'SPR-001', storeCategoryId: spr.storeCategoryId });

    const other = await addLocation(a.companyId, a.siteId, 'Plain 2');
    await expect(
      warehouses.update(other.warehouseId, a.companyId, { storeCategoryId: spr.storeCategoryId } as never, actor),
    ).rejects.toMatchObject({ response: { code: 'STORE_CATEGORY_INACTIVE' } });
  });

  it('tenant isolation: another company category id is NOT_FOUND', async () => {
    const bCategory = ((await categories.findAll(b.companyId)).items as Row[])[0];
    const notFound = { status: 404, response: { code: 'STORE_CATEGORY_NOT_FOUND' } };
    await expect(categories.findOne(bCategory.storeCategoryId, a.companyId)).rejects.toMatchObject(notFound);
    await expect(categories.update(bCategory.storeCategoryId, a.companyId, { name: 'x' } as never, actor)).rejects.toMatchObject(notFound);
    await expect(categories.remove(bCategory.storeCategoryId, a.companyId, actor)).rejects.toMatchObject(notFound);
    await expect(addLocation(a.companyId, a.siteId, 'Cross', bCategory.storeCategoryId)).rejects.toMatchObject(notFound);
  });

  it('concurrent creates in one category never share a code', async () => {
    const els = await addCategory(a.companyId, 'Electrical Store', 'ELS');
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, i) => addLocation(a.companyId, a.siteId, `Electrical ${i}`, els.storeCategoryId)),
    );
    expect(created.map((r) => r.locationCode).sort()).toEqual(['ELS-001', 'ELS-002', 'ELS-003', 'ELS-004', 'ELS-005', 'ELS-006']);
  });
});
