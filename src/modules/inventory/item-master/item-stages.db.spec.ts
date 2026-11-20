/**
 * Real-database test of RM + process (PLT / MCN) stage parts — two part numbers only.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest item-stages.db --runInBand
 */
import { BusinessException } from '@/common/exceptions/business.exception';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { ITEM_GROUP_ERROR_CODES } from '@/modules/inventory/item-groups/item-groups.constants';
import { ItemGroupsRepository } from '@/modules/inventory/item-groups/item-groups.repository';
import { ItemGroupsService } from '@/modules/inventory/item-groups/item-groups.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { PartNumberGeneratorService } from '@/modules/shared/number-series/part-number-generator.service';
import { ITEM_STAGE_ERROR_CODES } from './item-stages';
import { ItemsRepository } from './items.repository';
import { ItemsService } from './items.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Item stage DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Row = Record<string, any>;

run('Item stages RM + process (database)', () => {
  jest.setTimeout(240_000);

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const groups = new ItemGroupsService(new ItemGroupsRepository(prisma), audit);
  const items = new ItemsService(
    new ItemsRepository(prisma),
    audit,
    { resolveUserDataScope: jest.fn(async () => ({ isRestricted: false, branchIds: [], departmentIds: [], warehouseIds: [] })) } as unknown as DataAccessPoliciesService,
    {} as StorageService,
    {
      persistCustomFields: jest.fn(async () => undefined),
      mergeEntityWithCustomFields: jest.fn(async (_c: string, _e: string, _id: string, r: unknown) => r),
    } as unknown as CustomFieldsValuesService,
    new PartNumberGeneratorService(),
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

  const chain = async (itemId: string) => {
    const rm = await prisma.item.findUniqueOrThrow({
      where: { itemId: BigInt(itemId) },
      select: {
        itemCode: true,
        materialStage: true,
        nextStageItem: {
          select: {
            itemCode: true,
            materialStage: true,
            itemGroupRef: { select: { categoryCode: true } },
            nextStageItem: { select: { itemCode: true } },
          },
        },
      },
    });
    return {
      rm: rm.itemCode,
      process: rm.nextStageItem?.itemCode ?? null,
      processCategory: rm.nextStageItem?.itemGroupRef?.categoryCode ?? null,
      third: rm.nextStageItem?.nextStageItem?.itemCode ?? null,
    };
  };

  beforeAll(async () => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const c = await prisma.company.create({ data: { companyCode: `STGT_${stamp}`.slice(0, 30), name: 'Item stage test' } });
    company = c.companyId;
    companyId = company.toString();
    const store = async (name: string, codePrefix: string, numberSeriesCode: string) =>
      (await prisma.storeCategory.create({ data: { companyId: company, name, codePrefix, numberSeriesCode } })).storeCategoryId.toString();
    ids.rmStore = await store('Raw Material Store', 'RMS', 'RM');
    ids.sfStore = await store('Semi-Finished Store', 'SFS', 'SF');
    ids.boStore = await store('Bought-Out Store', 'BOS', 'BO');
    await prisma.numberSeriesConfig.create({
      data: { companyId: company, documentType: 'ITEM', prefix: 'TST', segmentSource: 'ITEM_GROUP', separator: 'NONE', serialLengthDefault: 5 },
    });
    ids.uom = (await prisma.uom.create({ data: { companyId: company, code: 'NOS', name: 'Numbers' } })).uomId.toString();
    const category = async (name: string, storeId: string, categoryCode: string, materialStage?: string) =>
      ((await groups.create(companyId, { name, storeCategoryId: storeId, categoryCode, materialStage } as never, actor)) as Row).itemGroupId as string;
    ids.rm = await category('Raw Materials', ids.rmStore, 'RM', 'RM');
    ids.plt = await category('Plates', ids.sfStore, 'PLT', 'SF');
    ids.mcn = await category('Machined Components', ids.sfStore, 'MCN', 'SF');
    ids.brg = await category('Bearings', ids.boStore, 'BRG');
  });

  afterAll(async () => {
    await prisma.userAudit.deleteMany({ where: { companyId: company } });
    await prisma.item.updateMany({ where: { companyId: company }, data: { previousStageItemId: null } });
    await prisma.company.delete({ where: { companyId: company } });
    await prisma.$disconnect();
  });

  const newRm = (description: string, processCategoryCode?: string) =>
    items.create(
      companyId,
      {
        description,
        storeCategoryId: ids.rmStore,
        itemGroupId: ids.rm,
        inventoryUomId: ids.uom,
        oldCode: `OLD-${description}`,
        ...(processCategoryCode
          ? { stagePlan: 'RM_PROCESS', processCategoryCode }
          : { stagePlan: 'RM_ONLY' }),
      } as never,
      actor,
    ) as Promise<Row>;

  it('plate part: one save creates RM + PLT only (no third part)', async () => {
    const rm = await newRm('MAIN SIDE PLATE', 'PLT');
    expect(await chain(rm.itemId)).toEqual({
      rm: 'TSTRM00001',
      process: 'TSTPLT00001',
      processCategory: 'PLT',
      third: null,
    });
    const process = await prisma.item.findFirstOrThrow({ where: { companyId: company, itemCode: 'TSTPLT00001' } });
    expect(process).toMatchObject({
      description: 'MAIN SIDE PLATE',
      oldCode: 'OLD-MAIN SIDE PLATE',
      materialStage: 'SF',
      itemGroupId: BigInt(ids.plt),
      inventoryUomId: BigInt(ids.uom),
    });
  });

  it('machined part: RM + MCN', async () => {
    const rm = await newRm('END SHAFT TOP', 'MCN');
    expect(await chain(rm.itemId)).toEqual({
      rm: 'TSTRM00002',
      process: 'TSTMCN00001',
      processCategory: 'MCN',
      third: null,
    });
  });

  it('RM only, then create the process part from the item page', async () => {
    const rm = await newRm('MS PIPE');
    expect(await chain(rm.itemId)).toEqual({ rm: 'TSTRM00003', process: null, processCategory: null, third: null });

    const created = (await items.createMissingStages(companyId, rm.itemId, 'MCN', actor)) as Row;
    expect(created.created.map((c: Row) => c.itemCode)).toEqual(['TSTMCN00002']);
    expect(await chain(rm.itemId)).toMatchObject({ process: 'TSTMCN00002', processCategory: 'MCN', third: null });

    const again = (await items.createMissingStages(companyId, rm.itemId, 'MCN', actor)) as Row;
    expect(again.created).toEqual([]);
  });

  it('process parts only for RM categories; many SF process categories are allowed', async () => {
    const bearing = items.create(
      companyId,
      { description: 'Bearing', storeCategoryId: ids.boStore, itemGroupId: ids.brg, stagePlan: 'RM_PROCESS', processCategoryCode: 'PLT' } as never,
      actor,
    );
    expect(await errorCode(bearing)).toBe(ITEM_STAGE_ERROR_CODES.NOT_RM);
    expect(await prisma.item.count({ where: { companyId: company, description: 'Bearing' } })).toBe(0);

    const fab = await groups.create(
      companyId,
      { name: 'Fabricated', storeCategoryId: ids.sfStore, categoryCode: 'FAB', materialStage: 'SF' } as never,
      actor,
    );
    expect((fab as Row).categoryCode).toBe('FAB');
  });

  it('unknown process category: nothing is created (one transaction)', async () => {
    const before = await prisma.item.count({ where: { companyId: company } });
    expect(await errorCode(newRm('ROLLER', 'XYZ'))).toBe(ITEM_STAGE_ERROR_CODES.CATEGORY_MISSING);
    expect(await prisma.item.count({ where: { companyId: company } })).toBe(before);
  });

  it('a second FF category is still refused', async () => {
    await groups.create(companyId, { name: 'Finished A', storeCategoryId: ids.sfStore, categoryCode: 'FFA', materialStage: 'FF' } as never, actor);
    expect(
      await errorCode(
        groups.create(companyId, { name: 'Finished B', storeCategoryId: ids.sfStore, categoryCode: 'FFB', materialStage: 'FF' } as never, actor),
      ),
    ).toBe(ITEM_GROUP_ERROR_CODES.STAGE_TAKEN);
  });
});
