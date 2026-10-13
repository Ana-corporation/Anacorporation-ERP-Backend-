/**
 * Real-database test of inventory locations (codes, site rules) and storage bins.
 * Creates two throw-away companies, deletes them after.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest warehouses.db
 */
import { Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BranchesRepository } from '../branches/branches.repository';
import { StorageBinsRepository } from '../storage-bins/storage-bins.repository';
import { StorageBinsService } from '../storage-bins/storage-bins.service';
import { UpdateWarehouseSchema } from './dto/warehouse.dto';
import { WarehousesRepository } from './warehouses.repository';
import { WarehousesService } from './warehouses.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Warehouse DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Row = Record<string, any>;

run('Store location codes (database)', () => {
  jest.setTimeout(180_000);

  const prisma = new PrismaService();
  const service = new WarehousesService(
    new WarehousesRepository(prisma),
    new BranchesRepository(prisma),
    new AuditService(prisma),
  );
  const bins = new StorageBinsService(new StorageBinsRepository(prisma), new WarehousesRepository(prisma), new AuditService(prisma));
  const actor = '1';
  const companies: bigint[] = [];
  let a: { companyId: string; siteId: string };
  let b: { companyId: string; siteId: string };

  async function makeCompany(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { companyCode: `WHT_${tag}_${stamp}`.slice(0, 30), name: `Store code test ${tag}` },
    });
    companies.push(company.companyId);
    const site = await prisma.branch.create({
      data: { companyId: company.companyId, branchCode: 'MAIN', name: 'Main site' },
    });
    return { companyId: company.companyId.toString(), siteId: site.branchId.toString() };
  }

  const create = (companyId: string, siteId: string, name: string, locationType: string) =>
    service.create(companyId, { name, branchId: siteId, locationType } as never, actor) as Promise<Row>;

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

  it('numbers each category separately per company', async () => {
    const rms1 = await create(a.companyId, a.siteId, 'Raw Material Store - Main', 'RawMaterialStore');
    const rms2 = await create(a.companyId, a.siteId, 'Raw Material Store - Assembly', 'RawMaterialStore');
    const spr1 = await create(a.companyId, a.siteId, 'Spares Store - Main', 'SparesStore');
    const fgs1 = await create(a.companyId, a.siteId, 'Finished Goods Store - Main', 'FinishedGoodsStore');
    const otherCompany = await create(b.companyId, b.siteId, 'Raw Material Store - Main', 'RawMaterialStore');

    expect([rms1, rms2, spr1, fgs1].map((r) => r.locationCode)).toEqual(['RMS-001', 'RMS-002', 'SPR-001', 'FGS-001']);
    expect(rms1.warehouseCode).toBe('RMS-001');
    expect(otherCompany.locationCode).toBe('RMS-001');
    expect(rms1.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set([rms1, rms2, spr1, fgs1, otherCompany].map((r) => r.uuid)).size).toBe(5);
  });

  it('database rejects a duplicate code within one company', async () => {
    const error = await prisma.warehouse
      .create({ data: { companyId: BigInt(a.companyId), branchId: BigInt(a.siteId), warehouseCode: 'RMS-001', name: 'Dup' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
  });

  it('concurrent creates never share a code', async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) => create(a.companyId, a.siteId, `Spares ${i}`, 'SparesStore')),
    );
    const codes = created.map((r) => r.locationCode).sort();
    expect(new Set(codes).size).toBe(8);
    expect(codes).toEqual(['SPR-002', 'SPR-003', 'SPR-004', 'SPR-005', 'SPR-006', 'SPR-007', 'SPR-008', 'SPR-009']);
  });

  it('a deleted code is never reused', async () => {
    const oil1 = await create(a.companyId, a.siteId, 'Oil Store', 'OilStore');
    await service.remove(oil1.warehouseId, a.companyId, actor);
    const oil2 = await create(a.companyId, a.siteId, 'Oil Store 2', 'OilStore');
    expect([oil1.locationCode, oil2.locationCode]).toEqual(['OIL-001', 'OIL-002']);
  });

  it('continues after existing codes and keeps legacy codes untouched', async () => {
    const legacy = await prisma.warehouse.create({
      data: { companyId: BigInt(b.companyId), branchId: BigInt(b.siteId), warehouseCode: 'MAIN_STORE', name: 'Main store' },
    });
    await prisma.warehouse.create({
      data: { companyId: BigInt(b.companyId), branchId: BigInt(b.siteId), warehouseCode: 'ELS-007', name: 'Typed by hand', locationType: 'ElectricalStore' },
    });
    const els = await create(b.companyId, b.siteId, 'Electrical Store', 'ElectricalStore');
    expect(els.locationCode).toBe('ELS-008');

    const found: Row = await service.findOne(legacy.warehouseId.toString(), b.companyId);
    expect(found).toMatchObject({ warehouseCode: 'MAIN_STORE', locationCode: 'MAIN_STORE', locationType: 'Store' });
    expect(found.uuid).toMatch(/^[0-9a-f-]{36}$/);
    const list: Row = await service.findAll(b.companyId, { page: 1, limit: 50 } as never);
    expect(list.items.map((r: Row) => r.locationCode)).toEqual(expect.arrayContaining(['MAIN_STORE', 'ELS-007', 'ELS-008', 'RMS-001']));
  });

  it('update never changes the code (even when the category changes)', async () => {
    const gen = await create(a.companyId, a.siteId, 'General Store', 'GeneralStore');
    const updated: Row = await service.update(
      gen.warehouseId,
      a.companyId,
      { name: 'General Store - Renamed', locationType: 'BoughtOutStore' } as never,
      actor,
    );
    expect(updated).toMatchObject({ name: 'General Store - Renamed', locationType: 'BoughtOutStore', locationCode: 'GEN-001' });
  });

  it('rejects other-company parents and cross-tenant access', async () => {
    await expect(create(a.companyId, b.siteId, 'Bad parent', 'RawMaterialStore')).rejects.toMatchObject({ status: 404 });
    await expect(create(a.companyId, '999999999', 'Missing parent', 'RawMaterialStore')).rejects.toMatchObject({ status: 404 });

    const aStore = await prisma.warehouse.findFirstOrThrow({ where: { companyId: BigInt(a.companyId) } });
    const id = aStore.warehouseId.toString();
    await expect(service.findOne(id, b.companyId)).rejects.toMatchObject({ status: 404 });
    await expect(service.update(id, b.companyId, { name: 'x' } as never, actor)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(id, b.companyId, actor)).rejects.toMatchObject({ status: 404 });

    const userOfB = { sub: '1', companyId: b.companyId, role: 'ADMIN', permissions: ['warehouses:create'] } as AuthenticatedUser;
    expect(() => assertCompanyAccess(a.companyId, userOfB)).toThrow(BusinessException);
  });

  it('site rules: address from site, one default per site, list filters, site required', async () => {
    const site2 = await prisma.branch.create({
      data: { companyId: BigInt(a.companyId), branchCode: 'PLANT2', name: 'Plant 2', address: '12 Industrial Estate' },
    });
    const site2Id = site2.branchId.toString();
    const category = await prisma.storeCategory.create({
      data: { companyId: BigInt(a.companyId), name: 'Raw Material Store', codePrefix: 'RAW' },
    });
    const categoryId = category.storeCategoryId.toString();

    const make = (siteId: string, name: string, extra: Record<string, unknown> = {}) =>
      service.create(a.companyId, { name, branchId: siteId, ...extra } as never, actor) as Promise<Row>;
    const x = await make(a.siteId, 'Default site 1', { isDefault: true });
    const y = await make(site2Id, 'Default site 2', { isDefault: true, storeCategoryId: categoryId });
    expect(y).toMatchObject({ address: '12 Industrial Estate', locationCode: 'RAW-001' });
    expect((await make(site2Id, 'Own address', { address: 'Gate 3' })).address).toBe('Gate 3');

    const z = await make(a.siteId, 'New default site 1', { isDefault: true });
    const defaults = await prisma.warehouse.findMany({
      where: { companyId: BigInt(a.companyId), isDefault: true, deletedAt: null },
      select: { warehouseId: true },
    });
    expect(defaults.map((d) => d.warehouseId.toString()).sort()).toEqual([y.warehouseId, z.warehouseId].sort());
    await service.update(x.warehouseId, a.companyId, { isDefault: true } as never, actor);
    expect((await service.findOne(z.warehouseId, a.companyId)).isDefault).toBe(false);
    expect((await service.findOne(y.warehouseId, a.companyId)).isDefault).toBe(true);

    const bySite: Row = await service.findAll(a.companyId, { page: 1, limit: 50, siteId: site2Id } as never);
    expect(bySite.items.map((r: Row) => r.name).sort()).toEqual(['Default site 2', 'Own address']);
    const byCategory: Row = await service.findAll(a.companyId, { page: 1, limit: 50, storeCategoryId: categoryId } as never);
    expect(byCategory.items.map((r: Row) => r.locationCode)).toEqual(['RAW-001']);

    expect(UpdateWarehouseSchema.safeParse({ branchId: null }).success).toBe(false);
    const moved: Row = await service.update(x.warehouseId, a.companyId, { branchId: site2Id } as never, actor);
    expect(moved.branchId).toBe(site2Id);
  });

  it('bins: unique per location, same code allowed in another location, bin management enforced', async () => {
    const binned = (name: string) =>
      service.create(a.companyId, { name, branchId: a.siteId, binManagement: true } as never, actor) as Promise<Row>;
    const l1 = await binned('Bins 1');
    const l2 = await binned('Bins 2');
    const plain = await create(a.companyId, a.siteId, 'No bins', 'GeneralStore');
    const bin = (locationId: string, binCode: string, companyId = a.companyId) =>
      bins.create(companyId, { inventoryLocationId: locationId, binCode } as never, actor) as Promise<Row>;
    const expectCode = (promise: Promise<unknown>, status: number, code: string) =>
      expect(promise).rejects.toMatchObject({ status, response: expect.objectContaining({ code }) });

    const first = await bin(l1.warehouseId, 'a-01');
    expect(first).toMatchObject({ binCode: 'A-01', inventoryLocationId: l1.warehouseId, companyId: a.companyId });
    await expectCode(bin(l1.warehouseId, ' A-01 '), 409, 'BIN_CODE_DUPLICATE');
    expect((await bin(l2.warehouseId, 'A-01')).binCode).toBe('A-01');
    await expectCode(bin(plain.warehouseId, 'A-01'), 400, 'BIN_MANAGEMENT_DISABLED');
    await expect(bin(l1.warehouseId, 'B-01', b.companyId)).rejects.toMatchObject({ status: 404 });

    const second = await bin(l1.warehouseId, 'A-02');
    await expectCode(bins.update(second.storageBinId, a.companyId, { binCode: 'A-01' } as never, actor), 409, 'BIN_CODE_DUPLICATE');
    await bins.remove(second.storageBinId, a.companyId, actor);
    await expectCode(bin(l1.warehouseId, 'A-02'), 409, 'BIN_CODE_DUPLICATE');

    await expectCode(service.update(l1.warehouseId, a.companyId, { binManagement: false } as never, actor), 400, 'LOCATION_HAS_BINS');
    await expect(service.update(l1.warehouseId, a.companyId, { branchId: a.siteId } as never, actor)).resolves.toBeDefined();
    await expectCode(service.remove(l1.warehouseId, a.companyId, actor), 400, 'LOCATION_HAS_BINS');
    expect((await service.update(plain.warehouseId, a.companyId, { binManagement: true } as never, actor)).binManagement).toBe(true);
    await service.remove(plain.warehouseId, a.companyId, actor);
  });

  it('bulk bins: skip or fail on clashes, limits, binCount on locations', async () => {
    const loc = (await service.create(a.companyId, { name: 'Bulk', branchId: a.siteId, binManagement: true } as never, actor)) as Row;
    const bulk = (codes: string[], skipExisting?: boolean, warehouseId = loc.warehouseId) =>
      bins.bulkCreate(
        a.companyId,
        { warehouseId, bins: codes.map((binCode) => ({ binCode, binName: `Bin ${binCode}` })), skipExisting } as never,
        actor,
      ) as Promise<Row>;
    const expectCode = (promise: Promise<unknown>, status: number, code: string, fields?: string[]) =>
      expect(promise).rejects.toMatchObject({
        status,
        response: expect.objectContaining({
          code,
          ...(fields ? { errors: fields.map((field) => expect.objectContaining({ field })) } : {}),
        }),
      });

    const first: Row = await bulk(['r01-s01', 'R01-S02', 'R01-S03']);
    expect(first.created.map((b: Row) => b.binCode)).toEqual(['R01-S01', 'R01-S02', 'R01-S03']);
    expect(first.created[0]).toMatchObject({ binName: 'Bin r01-s01', warehouseId: loc.warehouseId, inventoryLocationId: loc.warehouseId });
    expect(first.skipped).toEqual([]);

    await bins.remove(first.created[2].storageBinId, a.companyId, actor);
    await expectCode(bulk(['R01-S04', 'R01-S01']), 409, 'BIN_CODE_DUPLICATE', ['bins.1.binCode']);
    expect(await prisma.storageBin.count({ where: { warehouseId: BigInt(loc.warehouseId), binCode: 'R01-S04' } })).toBe(0);

    const second: Row = await bulk(['R01-S01', 'R01-S03', 'R01-S04', 'R01-S05'], true);
    expect(second.created.map((b: Row) => b.binCode)).toEqual(['R01-S04', 'R01-S05']);
    expect(second.skipped).toEqual([
      { binCode: 'R01-S01', reason: 'EXISTS' },
      { binCode: 'R01-S03', reason: 'DELETED_CODE' },
    ]);

    await expectCode(bulk(['X-1', 'x-1 ']), 400, 'BIN_CODE_DUPLICATE', ['bins.1.binCode']);
    await expectCode(bulk(Array.from({ length: 501 }, (_, i) => `B-${i}`)), 400, 'BIN_BULK_LIMIT');
    const plain = await create(a.companyId, a.siteId, 'Bulk no bins', 'GeneralStore');
    await expectCode(bulk(['A-1'], true, plain.warehouseId), 400, 'BIN_MANAGEMENT_DISABLED');
    await expect(bins.bulkCreate(b.companyId, { warehouseId: loc.warehouseId, bins: [{ binCode: 'A-1' }] } as never, actor)).rejects.toMatchObject({ status: 404 });

    const big: Row = await bulk(Array.from({ length: 500 }, (_, i) => `G-${String(i).padStart(3, '0')}`));
    expect(big.created).toHaveLength(500);

    await bins.update(second.created[1].storageBinId, a.companyId, { isActive: false } as never, actor);
    expect((await service.findOne(loc.warehouseId, a.companyId)).binCount).toBe(2 + 1 + 500);
    const list: Row = await service.findAll(a.companyId, { page: 1, limit: 100 } as never);
    const row = list.items.find((r: Row) => r.warehouseId === loc.warehouseId);
    expect(row).toMatchObject({ binCount: 503 });
    expect(row._count).toBeUndefined();
    expect(list.items.find((r: Row) => r.warehouseId === plain.warehouseId).binCount).toBe(0);
  });
});
