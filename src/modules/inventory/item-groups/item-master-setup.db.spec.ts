/**
 * Real-database test of the Item Master setup: Item Group tree, UOM master, item links and rules,
 * and Form Configuration mandatory / label overrides. Creates throw-away companies.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest item-master-setup.db --runInBand
 */
import { BusinessException } from '@/common/exceptions/business.exception';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { ItemsRepository } from '@/modules/inventory/item-master/items.repository';
import { ITEM_ERROR_CODES, ItemsService } from '@/modules/inventory/item-master/items.service';
import { CustomFieldsRepository } from '@/modules/shared/custom-fields/custom-fields.repository';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { FormConfigurationRepository } from '@/modules/shared/form-configuration/form-configuration.repository';
import { FormConfigurationService } from '@/modules/shared/form-configuration/form-configuration.service';
import { PartNumberGeneratorService } from '@/modules/shared/number-series/part-number-generator.service';
import { TabAccessRepository } from '@/modules/shared/tab-access/tab-access.repository';
import { TabAccessService } from '@/modules/shared/tab-access/tab-access.service';
import { UOM_ERROR_CODES, UomsService } from '../uoms/uoms.service';
import { ITEM_GROUP_ERROR_CODES } from './item-groups.constants';
import { ItemGroupsRepository } from './item-groups.repository';
import { ItemGroupsService } from './item-groups.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Item master DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Row = Record<string, any>;

run('Item master setup (database)', () => {
  jest.setTimeout(180_000);

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const groups = new ItemGroupsService(new ItemGroupsRepository(prisma), audit);
  const uoms = new UomsService(prisma, audit);
  const formConfig = new FormConfigurationService(
    new FormConfigurationRepository(prisma),
    new TabAccessService(new TabAccessRepository(prisma)),
    new CustomFieldsRepository(prisma),
    audit,
  );
  const items = new ItemsService(
    new ItemsRepository(prisma),
    audit,
    {} as DataAccessPoliciesService,
    {} as StorageService,
    {
      persistCustomFields: jest.fn(async () => undefined),
      mergeEntityWithCustomFields: jest.fn(async (_c: string, _e: string, _id: string, row: unknown) => row),
    } as unknown as CustomFieldsValuesService,
    new PartNumberGeneratorService(),
    formConfig,
  );
  const actor = '1';
  const companies: bigint[] = [];

  async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof BusinessException) return (e.getResponse() as { code?: string }).code;
      throw e;
    }
    return undefined;
  }

  let companyId: string;
  let bo: string;
  let fg: string;

  beforeAll(async () => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { companyCode: `IMST_${stamp}`.slice(0, 30), name: 'Item master setup test' },
    });
    companies.push(company.companyId);
    companyId = company.companyId.toString();
    const cat = (name: string, codePrefix: string) =>
      prisma.storeCategory.create({ data: { companyId: company.companyId, name, codePrefix } });
    bo = (await cat('Bought-Out Store', 'BOS')).storeCategoryId.toString();
    fg = (await cat('Finished Goods Store', 'FGS')).storeCategoryId.toString();
  });

  afterAll(async () => {
    for (const id of companies) {
      await prisma.stockBalance.deleteMany({ where: { companyId: id } });
      await prisma.userAudit.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { companyId: id } });
    }
    await prisma.$disconnect();
  });

  const ids: Record<string, string> = {};

  it('item groups: tree per store, unique names per level, no cycles, delete only when empty', async () => {
    const bearings: Row = await groups.create(companyId, { name: 'Bearings', storeCategoryId: bo } as never, actor);
    const ball: Row = await groups.create(companyId, { name: 'Ball', parentId: bearings.itemGroupId } as never, actor);
    const deep: Row = await groups.create(companyId, { name: '6204', parentId: ball.itemGroupId } as never, actor);
    const pumps: Row = await groups.create(companyId, { name: 'Pumps', storeCategoryId: fg } as never, actor);
    Object.assign(ids, { bearings: bearings.itemGroupId, ball: ball.itemGroupId, deep: deep.itemGroupId, pumps: pumps.itemGroupId });

    expect(ball).toMatchObject({ storeCategoryId: bo, depth: 1, path: 'Bearings / Ball' });
    expect(deep).toMatchObject({ depth: 2, path: 'Bearings / Ball / 6204' });

    expect(await errorCode(groups.create(companyId, { name: 'ball', parentId: ids.bearings } as never, actor))).toBe(
      ITEM_GROUP_ERROR_CODES.NAME_EXISTS,
    );
    await expect(groups.create(companyId, { name: 'Ball', storeCategoryId: bo } as never, actor)).resolves.toBeTruthy();
    expect(
      await errorCode(groups.create(companyId, { name: 'X', parentId: ids.pumps, storeCategoryId: bo } as never, actor)),
    ).toBe(ITEM_GROUP_ERROR_CODES.PARENT_INVALID);
    expect(await errorCode(groups.update(ids.bearings, companyId, { parentId: ids.deep } as never, actor))).toBe(
      ITEM_GROUP_ERROR_CODES.PARENT_INVALID,
    );
    expect(await errorCode(groups.update(ids.ball, companyId, { parentId: ids.pumps } as never, actor))).toBe(
      ITEM_GROUP_ERROR_CODES.PARENT_INVALID,
    );
    expect(await errorCode(groups.remove(ids.bearings, companyId, actor))).toBe(ITEM_GROUP_ERROR_CODES.IN_USE);

    const tree: Row[] = await groups.tree(companyId, { storeCategoryId: bo, includeInactive: false });
    const root = tree.find((n) => n.name === 'Bearings')!;
    expect(root.children[0]).toMatchObject({ name: 'Ball', children: [{ name: '6204' }] });
    const flat = await groups.findAll(companyId, { storeCategoryId: fg, includeInactive: false });
    expect(flat.items.map((g: Row) => g.name)).toEqual(['Pumps']);
  });

  it('UOM master: uppercase code, unique per company', async () => {
    const nos: Row = await uoms.create(companyId, { code: 'nos', name: 'Numbers' } as never, actor);
    ids.nos = nos.uomId;
    expect(nos.code).toBe('NOS');
    expect(await errorCode(uoms.create(companyId, { code: 'NOS', name: 'Again' } as never, actor))).toBe(
      UOM_ERROR_CODES.CODE_EXISTS,
    );
  });

  it('items: group must be in the item store, UOM copied to inventory.uomName, master refs returned', async () => {
    expect(
      await errorCode(
        items.create(companyId, { description: 'Pump body', storeCategoryId: fg, itemGroupId: ids.ball } as never, actor),
      ),
    ).toBe(ITEM_ERROR_CODES.GROUP_STORE_MISMATCH);

    const item: Row = await items.create(
      companyId,
      { description: 'Bearing 6204', storeCategoryId: bo, itemGroupId: ids.deep, inventoryUomId: ids.nos, status: 'draft' } as never,
      actor,
    );
    ids.item = String(item.itemId);
    expect(item).toMatchObject({
      status: 'draft',
      itemGroupId: ids.deep,
      inventoryUomId: ids.nos,
      itemGroupRef: { name: '6204' },
      inventoryUom: { code: 'NOS' },
      inventoryJson: { uomName: 'NOS' },
    });

    const list = await items.findAll(companyId, { itemGroupId: ids.bearings, page: 1, limit: 20 } as never);
    expect(list.items.map((i: Row) => i.description)).toEqual(['Bearing 6204']);
    expect(await errorCode(uoms.remove(ids.nos, companyId, actor))).toBe(UOM_ERROR_CODES.IN_USE);
  });

  it('duplicate name in the same store warns; confirm saves; other store is fine', async () => {
    expect(await errorCode(items.create(companyId, { description: 'bearing 6204', storeCategoryId: bo } as never, actor))).toBe(
      ITEM_ERROR_CODES.NAME_DUPLICATE,
    );
    await expect(
      items.create(companyId, { description: 'bearing 6204', storeCategoryId: bo, confirmDuplicateName: true } as never, actor),
    ).resolves.toBeTruthy();
    await expect(items.create(companyId, { description: 'Bearing 6204', storeCategoryId: fg } as never, actor)).resolves.toBeTruthy();
  });

  it('item with stock cannot be deleted', async () => {
    const warehouse = await prisma.warehouse.create({
      data: { companyId: BigInt(companyId), warehouseCode: 'BOS-001', name: 'Bought-out' },
    });
    await prisma.stockBalance.create({
      data: { companyId: BigInt(companyId), itemId: BigInt(ids.item), warehouseId: warehouse.warehouseId, quantity: 5 },
    });
    expect(await errorCode(items.remove(ids.item, companyId, actor))).toBe(ITEM_ERROR_CODES.IN_USE);
  });

  it('Form Configuration: mandatory + label per company, hidden field never required', async () => {
    expect(
      await errorCode(formConfig.updateConfiguration(companyId, 'item', { fields: [{ fieldKey: 'description', isRequired: false }] })),
    ).toBe('PROTECTED_FIELD_REQUIRED_LOCKED');

    const config: Row = await formConfig.updateConfiguration(companyId, 'item', {
      fields: [
        { fieldKey: 'storeCategoryId', isVisible: true, isRequired: true },
        { fieldKey: 'itemGroupId', isVisible: true, isRequired: true, label: 'Item Group' },
        { fieldKey: 'itemCode', label: 'Part Number' },
        { fieldKey: 'description', label: 'Part Name' },
      ],
    });
    const field = (key: string) =>
      config.sections.flatMap((s: Row) => s.fields).find((f: Row) => f.fieldKey === key);
    expect(field('itemCode')).toMatchObject({ label: 'Part Number', defaultLabel: 'Item code' });
    expect(field('itemGroupId')).toMatchObject({ label: 'Item Group', required: true, visible: true });
    expect(field('storeCategoryId')).toMatchObject({ required: true, visible: true });

    const err = await items.create(companyId, { description: 'No group' } as never, actor).catch((e) => e);
    expect((err as BusinessException).getResponse()).toMatchObject({
      code: ITEM_ERROR_CODES.REQUIRED_FIELDS,
      errors: [{ field: 'storeCategoryId' }, { field: 'itemGroupId', message: 'Item Group is required' }],
    });

    await formConfig.updateConfiguration(companyId, 'item', { fields: [{ fieldKey: 'itemGroupId', isVisible: false }] });
    const after: Row = await formConfig.getConfiguration(companyId, 'item');
    const group = after.sections.flatMap((s: Row) => s.fields).find((f: Row) => f.fieldKey === 'itemGroupId');
    expect(group).toMatchObject({ visible: false, required: false, label: 'Item Group' });
    await expect(items.create(companyId, { description: 'Spare seal', storeCategoryId: bo } as never, actor)).resolves.toBeTruthy();
  });
});
