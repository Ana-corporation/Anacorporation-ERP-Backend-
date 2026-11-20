/**
 * Real-database tests of the Machine master + customised machines (BS500 -> BS500-SO00045).
 * Creates throw-away companies on DEV and deletes them afterwards.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest machines.db --runInBand
 */
import { randomUUID } from 'crypto';
import { BusinessException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import { ItemsLookupService } from '@/modules/inventory/item-master/items-lookup.service';
import { ItemsRepository } from '@/modules/inventory/item-master/items.repository';
import { ItemsService } from '@/modules/inventory/item-master/items.service';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { DocumentNumberService } from '@/modules/shared/number-series/document-number.service';
import { PartNumberGeneratorService } from '@/modules/shared/number-series/part-number-generator.service';
import { IdempotencyService } from '@/modules/shared/idempotency/idempotency.service';
import { BOM_ERROR_CODES } from '../bom/bom.constants';
import { BomLinesService } from '../bom/bom-lines.service';
import { BomViewService } from '../bom/bom-view.service';
import { BomsRepository } from '../bom/boms.repository';
import { BomsService } from '../bom/boms.service';
import { MACHINE_ERROR_CODES } from './machines.constants';
import { MachinesService } from './machines.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('Machine DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

run('Machine master (database)', () => {
  jest.setTimeout(300_000);

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const generator = new PartNumberGeneratorService();
  const items = new ItemsService(
    new ItemsRepository(prisma),
    audit,
    {} as DataAccessPoliciesService,
    {} as StorageService,
    { persistCustomFields: jest.fn(async () => undefined) } as unknown as CustomFieldsValuesService,
    generator,
    { loadFieldOverrides: jest.fn(async () => ({ visibility: new Map(), registration: new Map(), order: new Map() })) } as never,
  );
  const repo = new BomsRepository(prisma);
  const view = new BomViewService(repo, audit);
  const bomLines = new BomLinesService(repo, view);
  const boms = new BomsService(repo, bomLines, view, new DocumentNumberService(prisma), new IdempotencyService(), audit);
  const machines = new MachinesService(prisma, items, boms, new IdempotencyService(), audit);
  const lookup = new ItemsLookupService(prisma);
  const user = { sub: '990000002', role: 'super_admin', permissions: [], modules: [], companyId: '0', subscriptionStatus: 'active' } as unknown as AuthenticatedUser;
  const companies: bigint[] = [];

  async function makeCompany(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({ data: { companyCode: `MCHT_${tag}_${stamp}`.slice(0, 30), name: `Machine test ${tag}` } });
    const cid = company.companyId;
    companies.push(cid);
    const nos = await prisma.uom.create({ data: { companyId: cid, code: 'NOS', name: 'Numbers' } });
    const fg = await prisma.storeCategory.create({ data: { companyId: cid, name: 'Finished Goods Store', codePrefix: 'FGS' } });
    const mac = await prisma.itemGroup.create({ data: { companyId: cid, storeCategoryId: fg.storeCategoryId, name: 'Machines', categoryCode: 'MAC' } });
    const field = await prisma.customFieldDefinition.create({
      data: {
        companyId: cid, entityType: 'item', fieldName: 'procurementType', displayName: 'Procurement Type', fieldType: 'dropdown', sectionKey: 'general',
        options: [{ value: 'Buy', label: 'Buy' }, { value: 'Make', label: 'Make' }, { value: 'Subcontract', label: 'Subcontract' }],
      },
    });
    const part = async (code: string, name: string) => {
      const it = await prisma.item.create({ data: { companyId: cid, itemCode: `${code}${stamp}`.slice(0, 50), description: name, inventoryUomId: nos.uomId } });
      await prisma.customFieldValue.create({ data: { companyId: cid, entityType: 'item', recordId: it.itemId, fieldId: field.fieldId, valueText: 'Buy' } });
      return it.itemId.toString();
    };
    const customer = await prisma.customer.create({ data: { companyId: cid, customerCode: `C${stamp}`.slice(0, 40), name: 'ABC Foods' } });
    return {
      cid,
      nos: nos.uomId.toString(),
      mac: mac.itemGroupId.toString(),
      fieldId: field.fieldId,
      customerId: customer.customerId.toString(),
      assy: await part('ASY', 'ROLLER ASSY'),
      shaft: await part('SHF', 'END SHAFT'),
      pipe: await part('PIP', 'MS PIPE'),
    };
  }

  async function code(promise: Promise<unknown>) {
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
  let bs500: Any;

  beforeAll(async () => {
    a = await makeCompany('A');
    b = await makeCompany('B');
  });

  afterAll(async () => {
    for (const companyId of companies) {
      await prisma.$executeRaw`DELETE FROM machines WHERE company_id = ${companyId} AND machine_type = 'ORDER'`;
      await prisma.$executeRaw`DELETE FROM machines WHERE company_id = ${companyId}`;
      await prisma.bom.deleteMany({ where: { companyId } });
      await prisma.userAudit.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { companyId } });
    }
    await prisma.$disconnect();
  });

  it('needs machine settings before creating machine items', async () => {
    expect(await code(machines.create(a.cid, { machineCode: 'BS500', name: 'BS500 MACHINE' } as never, user))).toBe(MACHINE_ERROR_CODES.SETTINGS_MISSING);
    const s = (await machines.saveSettings(a.cid, { itemGroupId: a.mac, uomId: a.nos } as never, user)) as Any;
    expect(s.configured).toBe(true);
    await machines.saveSettings(b.cid, { itemGroupId: b.mac, uomId: b.nos } as never, user);
  });

  it('create base machine: item created in the Machines category, oldCode = code, procurement Make', async () => {
    bs500 = (await machines.create(a.cid, { machineCode: 'bs500', name: 'BS500 MACHINE', series: 'BS', model: '500' } as never, user)) as Any;
    expect(bs500.machineCode).toBe('BS500');
    expect(bs500.machineType).toBe('BASE');
    expect(bs500.item.oldCode).toBe('BS500');
    expect(bs500.item.itemGroupRef.categoryCode).toBe('MAC');
    const proc = await prisma.customFieldValue.findFirst({ where: { fieldId: a.fieldId, recordId: BigInt(bs500.item.itemId) } });
    expect(proc?.valueText).toBe('Make');
    expect(bs500.allowedActions).toEqual(expect.arrayContaining(['edit', 'createVariant', 'createBom']));
  });

  it('invalid / duplicate code; link an existing item only once', async () => {
    expect(await code(machines.create(a.cid, { machineCode: 'BS 500', name: 'x' } as never, user))).toBe(MACHINE_ERROR_CODES.CODE_INVALID);
    expect(await code(machines.create(a.cid, { machineCode: 'BS500', name: 'x' } as never, user))).toBe(MACHINE_ERROR_CODES.CODE_EXISTS);
    const linked = (await machines.create(a.cid, { machineCode: 'ZETA700', name: 'ZETA 700', linkItemId: a.assy } as never, user)) as Any;
    expect(linked.item.itemId).toBe(a.assy);
    expect(await code(machines.create(a.cid, { machineCode: 'ZETA750', name: 'ZETA 750', linkItemId: a.assy } as never, user))).toBe(MACHINE_ERROR_CODES.ITEM_ALREADY_LINKED);
    expect(await code(machines.get(b.cid, BigInt(linked.machineId), user))).toBe(MACHINE_ERROR_CODES.NOT_FOUND);
  });

  it('component picker excludes machine items; machine lookup lists machines', async () => {
    const res = (await lookup.lookup(a.cid.toString(), { limit: 50, excludeMachines: true } as never)) as Any;
    const ids = res.items.map((i: Any) => i.itemId);
    expect(ids).not.toContain(bs500.item.itemId);
    expect(ids).toContain(a.shaft);
    const m = (await machines.lookup(a.cid, { limit: 20 } as never)) as Any;
    expect(m.items.map((x: Any) => x.machineCode)).toEqual(expect.arrayContaining(['BS500']));
  });

  let baseBomId: string;

  it('BOM by machineId uses the machine item; variant needs the base BOM released', async () => {
    const bom = (await boms.create(
      a.cid,
      {
        machineId: bs500.machineId,
        bomType: 'MANUFACTURING',
        bomScope: 'STANDARD',
        groups: [{ main: { componentItemId: a.shaft, quantity: 1 }, subLines: [{ componentItemId: a.pipe, quantity: 2 }] }],
      } as never,
      user,
    )) as Any;
    expect(bom.parentItem.itemId).toBe(bs500.item.itemId);
    expect(bom.machine.machineCode).toBe('BS500');
    baseBomId = bom.bomId;
    expect(await code(machines.createVariant(a.cid, BigInt(bs500.machineId), { salesOrderNo: 'SO00045' } as never, user, `k-${randomUUID()}`))).toBe(MACHINE_ERROR_CODES.BASE_BOM_NOT_RELEASED);
    await boms.release(a.cid, BigInt(baseBomId), {} as never, user, `k-${randomUUID()}`);
  });

  let variant: Any;

  it('customised machine BS500-SO00045: own item + CUSTOMER BOM copied with the same keys; idempotent', async () => {
    expect(await code(machines.createVariant(a.cid, BigInt(bs500.machineId), { salesOrderNo: 'SO45' } as never, user, `k-${randomUUID()}`))).toBe(MACHINE_ERROR_CODES.SALES_ORDER_NO_INVALID);
    const k = `k-${randomUUID()}`;
    variant = (await machines.createVariant(a.cid, BigInt(bs500.machineId), { salesOrderNo: 'so00045', customerId: a.customerId, remarks: 'Extra printing unit' } as never, user, k)) as Any;
    expect(variant.machineCode).toBe('BS500-SO00045');
    expect(variant.machineType).toBe('ORDER');
    expect(variant.baseMachine.machineCode).toBe('BS500');
    expect(variant.customer.name).toBe('ABC Foods');
    expect(variant.item.itemId).not.toBe(bs500.item.itemId);

    const again = (await machines.createVariant(a.cid, BigInt(bs500.machineId), { salesOrderNo: 'so00045', customerId: a.customerId, remarks: 'Extra printing unit' } as never, user, k)) as Any;
    expect(again.machineId).toBe(variant.machineId);
    expect(await prisma.machine.count({ where: { companyId: a.cid, machineType: 'ORDER' } })).toBe(1);
    expect(await code(machines.createVariant(a.cid, BigInt(bs500.machineId), { salesOrderNo: 'SO00045' } as never, user, `k-${randomUUID()}`))).toBe(MACHINE_ERROR_CODES.VARIANT_EXISTS);
    expect(await code(machines.createVariant(a.cid, BigInt(variant.machineId), { salesOrderNo: 'SO00046' } as never, user, `k-${randomUUID()}`))).toBe(MACHINE_ERROR_CODES.VARIANT_OF_VARIANT);

    const copy = (await boms.get(a.cid, BigInt(variant.createdBom.bomId), user)) as Any;
    const base = (await boms.get(a.cid, BigInt(baseBomId), user)) as Any;
    expect(copy.bomScope).toBe('CUSTOMER');
    expect(copy.status).toBe('DRAFT');
    expect(copy.baseBom.bomId).toBe(baseBomId);
    expect(copy.customer.name).toBe('ABC Foods');
    expect(copy.machine.machineCode).toBe('BS500-SO00045');
    expect(copy.groups.map((g: Any) => g.commonKey)).toEqual(base.groups.map((g: Any) => g.commonKey));
    expect(copy.groups[0].subLines[0].parentLineId).toBe(copy.groups[0].main.lineId);
    expect(base.status).toBe('RELEASED');
  });

  it('customer BOM releases next to the standard BOM; BOM for a customised machine only via variants', async () => {
    const released = (await boms.release(a.cid, BigInt(variant.createdBom.bomId), {} as never, user, `k-${randomUUID()}`)) as Any;
    expect(released.status).toBe('RELEASED');
    const base = await prisma.bom.findUniqueOrThrow({ where: { bomId: BigInt(baseBomId) } });
    expect(base.status).toBe('RELEASED');
    expect(await code(boms.create(a.cid, { machineId: variant.machineId, bomType: 'MANUFACTURING', bomScope: 'STANDARD', groups: [] } as never, user))).toBe(
      BOM_ERROR_CODES.MACHINE_VARIANT_BOM_VIA_VARIANT,
    );
    const byItem = (await boms.byItem(a.cid, BigInt(variant.item.itemId), {} as never, user)) as Any;
    expect(byItem.bomId).toBe(variant.createdBom.bomId);
  });

  it('delete is blocked while BOMs / variants exist; update mirrors name to the item', async () => {
    expect(await code(machines.remove(a.cid, BigInt(bs500.machineId), user))).toBe(MACHINE_ERROR_CODES.IN_USE);
    const fresh = (await machines.get(a.cid, BigInt(bs500.machineId), user)) as Any;
    const updated = (await machines.update(a.cid, BigInt(bs500.machineId), { rowVersion: fresh.rowVersion, name: 'BS500 BAG SEALER' } as never, user)) as Any;
    expect(updated.item.description).toBe('BS500 BAG SEALER');
    expect(await code(machines.update(a.cid, BigInt(bs500.machineId), { rowVersion: fresh.rowVersion, name: 'stale' } as never, user))).toBe(MACHINE_ERROR_CODES.ROW_VERSION_CONFLICT);
    const empty = (await machines.create(b.cid, { machineCode: 'TEST1', name: 'Test' } as never, user)) as Any;
    await machines.remove(b.cid, BigInt(empty.machineId), user);
    expect(await code(machines.get(b.cid, BigInt(empty.machineId), user))).toBe(MACHINE_ERROR_CODES.NOT_FOUND);
  });
});
