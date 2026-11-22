/**
 * Real-database tests of the BOM module (MAIN / SUB, Common Key, release, revision, requirements).
 * Creates throw-away companies on DEV and deletes them afterwards.
 *   RUN_DB_TESTS=1 NODE_ENV=development npx jest boms.db --runInBand
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { BusinessException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { resolveDatabaseEnv } from '@/config/resolve-database-env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DocumentNumberService } from '@/modules/shared/number-series/document-number.service';
import { IdempotencyService } from '@/modules/shared/idempotency/idempotency.service';
import { BOM_ERROR_CODES } from './bom.constants';
import { BomLinesService } from './bom-lines.service';
import { BomViewService } from './bom-view.service';
import { BomsRepository } from './boms.repository';
import { BomsService } from './boms.service';

const enabled = process.env.RUN_DB_TESTS === '1';
if (enabled && resolveDatabaseEnv().dbLabel !== 'DEV') {
  throw new Error('BOM DB tests only run against the DEV database (NODE_ENV=development).');
}
const run = enabled ? describe : describe.skip;

type Detail = Awaited<ReturnType<BomsService['get']>> & {
  bomId: string;
  status: string;
  version: number;
  rowVersion: number;
  bomNumber: string;
  nextCommonKey: number;
  isCurrentVersion: boolean;
  affectedLineId?: string;
  allowedActions: string[];
  groups: Array<{
    commonKey: string;
    main: { lineId: string; componentItemId: string; itemName: string; commonKey: string };
    subLines: Array<{ lineId: string; componentItemId: string; commonKey: string; parentLineId: string; itemName: string }>;
  }>;
};

run('BOM module (database)', () => {
  jest.setTimeout(300_000);

  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const repository = new BomsRepository(prisma);
  const view = new BomViewService(repository, audit);
  const lines = new BomLinesService(repository, view);
  const boms = new BomsService(repository, lines, view, new DocumentNumberService(prisma), new IdempotencyService(), audit);
  const user = { sub: '990000001', role: 'super_admin', permissions: [], modules: [], email: 't@test', sessionId: 's', companyId: '0', subscriptionStatus: 'active', firstName: 'T', lastName: 'T' } as unknown as AuthenticatedUser;
  const companies: bigint[] = [];

  type Fixture = Awaited<ReturnType<typeof makeCompany>>;

  async function makeCompany(tag: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({ data: { companyCode: `BOMT_${tag}_${stamp}`.slice(0, 30), name: `BOM test ${tag}` } });
    const cid = company.companyId;
    companies.push(cid);
    const nos = await prisma.uom.create({ data: { companyId: cid, code: 'NOS', name: 'Numbers' } });
    const kg = await prisma.uom.create({ data: { companyId: cid, code: 'KG', name: 'Kilogram' } });
    const field = await prisma.customFieldDefinition.create({
      data: {
        companyId: cid,
        entityType: 'item',
        fieldName: 'procurementType',
        displayName: 'Procurement Type',
        fieldType: 'dropdown',
        sectionKey: 'general',
        options: [{ value: 'Buy', label: 'Buy' }, { value: 'Make', label: 'Make' }, { value: 'Subcontract', label: 'Subcontract' }],
      },
    });
    const mk = async (code: string, name: string, procurement: 'Buy' | 'Make', extra: Partial<Prisma.ItemUncheckedCreateInput> = {}) => {
      const item = await prisma.item.create({ data: { companyId: cid, itemCode: `${code}${stamp}`.slice(0, 50), description: name, inventoryUomId: nos.uomId, ...extra } });
      await prisma.customFieldValue.create({ data: { companyId: cid, entityType: 'item', recordId: item.itemId, fieldId: field.fieldId, valueText: procurement } });
      return item.itemId.toString();
    };
    return {
      companyId: cid,
      nos: nos.uomId.toString(),
      kg: kg.uomId.toString(),
      bs500: await mk('BS500', 'BS500 MACHINE', 'Make'),
      topAssy: await mk('TOP', 'MS PIPE ROLLER TOP ASSY', 'Make'),
      bottomAssy: await mk('BOT', 'MS PIPE ROLLER BOTTOM ASSY', 'Make'),
      endShaftTop: await mk('EST', 'END SHAFT TOP', 'Buy'),
      endShaftBottom: await mk('ESB', 'END SHAFT BOTTOM', 'Buy'),
      msPipe: await mk('MSP', 'MS PIPE', 'Buy'),
      boughtOut: await mk('BUY', 'BOUGHT OUT PART', 'Buy'),
      inactive: await mk('INA', 'INACTIVE PART', 'Buy', { isActive: false }),
      zeta: await mk('ZETA', 'ZETA 700', 'Make'),
    };
  }

  async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof BusinessException) return (e.getResponse() as { code?: string }).code;
      if (e instanceof Prisma.PrismaClientKnownRequestError) return `PRISMA_${e.code}`;
      throw e;
    }
    return undefined;
  }

  /** BS500 with the two roller groups of the design document. */
  async function createBs500(f: Fixture, extra: Record<string, unknown> = {}) {
    return (await boms.create(
      f.companyId,
      {
        parentItemId: f.bs500,
        bomType: 'MANUFACTURING',
        bomScope: 'STANDARD',
        groups: [
          { main: { componentItemId: f.topAssy, quantity: 1 }, subLines: [{ componentItemId: f.endShaftTop, quantity: 2 }, { componentItemId: f.msPipe, quantity: 1 }] },
          { main: { componentItemId: f.bottomAssy, quantity: 1 }, subLines: [{ componentItemId: f.endShaftBottom, quantity: 2 }, { componentItemId: f.msPipe, quantity: '1' }] },
        ],
        ...extra,
      } as never,
      user,
    )) as unknown as Detail;
  }

  const key = () => `test-${randomUUID()}`;
  const id = (v: string) => BigInt(v);

  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    a = await makeCompany('A');
    b = await makeCompany('B');
  });

  afterAll(async () => {
    for (const companyId of companies) {
      await prisma.bom.deleteMany({ where: { companyId } });
      await prisma.userAudit.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { companyId } });
    }
    await prisma.$disconnect();
  });

  it('create: DRAFT, BOM number from the series, groups keyed 1 and 2, SUB lines inherit key + parent', async () => {
    const bom = await createBs500(a);
    expect(bom.status).toBe('DRAFT');
    expect(bom.bomNumber).toMatch(/^BOM\d{5}$/);
    expect(bom.nextCommonKey).toBe(3);
    expect(bom.groups.map((g) => g.commonKey)).toEqual(['1', '2']);
    for (const g of bom.groups) {
      for (const s of g.subLines) {
        expect(s.commonKey).toBe(g.commonKey);
        expect(s.parentLineId).toBe(g.main.lineId);
      }
    }
    expect(bom.groups[0].subLines.map((s) => s.componentItemId)).toEqual([a.endShaftTop, a.msPipe]);
    expect(bom.groups[1].subLines.map((s) => s.componentItemId)).toEqual([a.endShaftBottom, a.msPipe]);
    expect(bom.allowedActions).toEqual(expect.arrayContaining(['addMain', 'release', 'delete']));
  });

  it('add MAIN allocates the next key; concurrent MAIN creations never share a key; keys are not reused after delete', async () => {
    const bom = await createBs500(a, { parentItemId: a.zeta, groups: [] });
    const first = (await lines.addMain(a.companyId, id(bom.bomId), { componentItemId: a.topAssy, quantity: 1 } as never, user)) as unknown as Detail;
    expect(first.groups.map((g) => g.commonKey)).toEqual(['1']);
    const results = await Promise.all(
      [a.bottomAssy, a.boughtOut, a.endShaftTop, a.endShaftBottom, a.msPipe].map((item) =>
        lines.addMain(a.companyId, id(bom.bomId), { componentItemId: item, quantity: 1 } as never, user),
      ),
    );
    const keys = (results.at(-1) as unknown as Detail).groups.map((g) => g.commonKey);
    const all = (await boms.get(a.companyId, id(bom.bomId), user)) as unknown as Detail;
    expect(new Set(all.groups.map((g) => g.commonKey)).size).toBe(6);
    expect(all.groups.map((g) => g.commonKey)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(keys.length).toBeGreaterThan(0);

    const last = all.groups.find((g) => g.commonKey === '6')!;
    await lines.deleteLine(a.companyId, id(bom.bomId), id(last.main.lineId), { withSubLines: false } as never, user);
    const next = (await lines.addMain(a.companyId, id(bom.bomId), { componentItemId: a.msPipe, quantity: 1 } as never, user)) as unknown as Detail;
    expect(next.groups.map((g) => g.commonKey)).toContain('7');
    expect(next.groups.map((g) => g.commonKey)).not.toContain('6');
  });

  it('client-sent commonKey / lineType / parentLineId -> FIELD_NOT_ALLOWED', async () => {
    const bom = await createBs500(a, { parentItemId: a.topAssy, groups: [] });
    const mainLine = (await lines.addMain(a.companyId, id(bom.bomId), { componentItemId: a.msPipe, quantity: 1 } as never, user)) as unknown as Detail;
    const mainId = id(mainLine.groups[0].main.lineId);
    expect(await errorCode(lines.addMain(a.companyId, id(bom.bomId), { componentItemId: a.endShaftTop, quantity: 1, commonKey: '99' } as never, user))).toBe(BOM_ERROR_CODES.FIELD_NOT_ALLOWED);
    expect(await errorCode(lines.addSub(a.companyId, id(bom.bomId), mainId, { componentItemId: a.endShaftTop, quantity: 1, lineType: 'MAIN' } as never, user))).toBe(BOM_ERROR_CODES.FIELD_NOT_ALLOWED);
    expect(await errorCode(lines.updateLine(a.companyId, id(bom.bomId), mainId, { parentLineId: '1' } as never, user))).toBe(BOM_ERROR_CODES.FIELD_NOT_ALLOWED);
  });

  it('SUB parent must be a MAIN of this BOM and company', async () => {
    const one = await createBs500(a, { parentItemId: a.topAssy, groups: [{ main: { componentItemId: a.msPipe, quantity: 1 }, subLines: [{ componentItemId: a.endShaftTop, quantity: 1 }] }] });
    const other = await createBs500(a, { parentItemId: a.bottomAssy, groups: [{ main: { componentItemId: a.msPipe, quantity: 1 } }] });
    const foreign = await createBs500(b, { groups: [{ main: { componentItemId: b.topAssy, quantity: 1 } }] });
    const body = { componentItemId: a.boughtOut, quantity: 1 } as never;
    expect(await errorCode(lines.addSub(a.companyId, id(one.bomId), 999999999n, body, user))).toBe(BOM_ERROR_CODES.MAIN_LINE_NOT_FOUND);
    expect(await errorCode(lines.addSub(a.companyId, id(one.bomId), id(other.groups[0].main.lineId), body, user))).toBe(BOM_ERROR_CODES.MAIN_LINE_NOT_FOUND);
    expect(await errorCode(lines.addSub(a.companyId, id(one.bomId), id(foreign.groups[0].main.lineId), body, user))).toBe(BOM_ERROR_CODES.MAIN_LINE_NOT_FOUND);
    expect(await errorCode(lines.addSub(a.companyId, id(one.bomId), id(one.groups[0].subLines[0].lineId), body, user))).toBe(BOM_ERROR_CODES.SUB_PARENT_MUST_BE_MAIN);
    // another company's BOM through this company -> not found, never revealed
    expect(await errorCode(boms.get(a.companyId, id(foreign.bomId), user))).toBe(BOM_ERROR_CODES.NOT_FOUND);
    expect(await errorCode(lines.addMain(a.companyId, id(foreign.bomId), body, user))).toBe(BOM_ERROR_CODES.NOT_FOUND);
  });

  it('same item in two groups is fine; twice in one group -> DUPLICATE_COMPONENT; parent as line -> SELF_REFERENCE', async () => {
    const bom = await createBs500(a, { bomType: 'ENGINEERING' });
    expect(bom.groups[0].subLines.some((s) => s.componentItemId === a.msPipe)).toBe(true);
    expect(bom.groups[1].subLines.some((s) => s.componentItemId === a.msPipe)).toBe(true);
    const mainId = id(bom.groups[0].main.lineId);
    expect(await errorCode(lines.addSub(a.companyId, id(bom.bomId), mainId, { componentItemId: a.msPipe, quantity: 3 } as never, user))).toBe(BOM_ERROR_CODES.DUPLICATE_COMPONENT);
    expect(await errorCode(lines.addSub(a.companyId, id(bom.bomId), mainId, { componentItemId: a.topAssy, quantity: 1 } as never, user))).toBe(BOM_ERROR_CODES.SELF_REFERENCE);
    expect(await errorCode(lines.addSub(a.companyId, id(bom.bomId), mainId, { componentItemId: a.bs500, quantity: 1 } as never, user))).toBe(BOM_ERROR_CODES.SELF_REFERENCE);
    expect(await errorCode(lines.addMain(a.companyId, id(bom.bomId), { componentItemId: a.bs500, quantity: 1 } as never, user))).toBe(BOM_ERROR_CODES.SELF_REFERENCE);
  });

  it('quantity <= 0, inactive item and another company item are rejected', async () => {
    const bom = await createBs500(a, { parentItemId: a.bottomAssy, groups: [] });
    const add = (body: Record<string, unknown>) => lines.addMain(a.companyId, id(bom.bomId), body as never, user);
    expect(await errorCode(add({ componentItemId: a.msPipe, quantity: 0 }))).toBe(BOM_ERROR_CODES.QTY_MUST_BE_POSITIVE);
    expect(await errorCode(add({ componentItemId: a.msPipe, quantity: '-2' }))).toBe(BOM_ERROR_CODES.QTY_MUST_BE_POSITIVE);
    expect(await errorCode(add({ componentItemId: a.msPipe, quantity: 1, scrapPercentage: 150 }))).toBe(BOM_ERROR_CODES.SCRAP_OUT_OF_RANGE);
    expect(await errorCode(add({ componentItemId: a.inactive, quantity: 1 }))).toBe(BOM_ERROR_CODES.COMPONENT_INACTIVE);
    expect(await errorCode(add({ componentItemId: b.msPipe, quantity: 1 }))).toBe(BOM_ERROR_CODES.COMPONENT_NOT_FOUND);
    expect(await errorCode(add({ componentItemId: a.msPipe, quantity: 1, uomId: a.kg }))).toBe(BOM_ERROR_CODES.UOM_INVALID);
  });

  it('parent must be a Make item', async () => {
    expect(await errorCode(createBs500(a, { parentItemId: a.boughtOut, groups: [] }))).toBe(BOM_ERROR_CODES.PARENT_NOT_MAKE_ITEM);
    expect(await errorCode(createBs500(a, { parentItemId: undefined, groups: [] }))).toBe(BOM_ERROR_CODES.PARENT_ITEM_REQUIRED);
  });

  it('delete MAIN with SUB lines needs withSubLines=true; then no orphan remains', async () => {
    const bom = await createBs500(b);
    const mainId = id(bom.groups[0].main.lineId);
    expect(await errorCode(lines.deleteLine(b.companyId, id(bom.bomId), mainId, { withSubLines: false } as never, user))).toBe(BOM_ERROR_CODES.MAIN_HAS_SUB_LINES);
    const after = (await lines.deleteLine(b.companyId, id(bom.bomId), mainId, { withSubLines: true } as never, user)) as unknown as Detail;
    expect(after.groups.map((g) => g.commonKey)).toEqual(['2']);
    expect(await prisma.bomLine.count({ where: { bomId: id(bom.bomId), commonKey: '1' } })).toBe(0);
    await boms.remove(b.companyId, id(bom.bomId), user);
  });

  it('stale rowVersion -> ROW_VERSION_CONFLICT', async () => {
    const bom = await createBs500(b, { parentItemId: b.zeta, groups: [] });
    await boms.updateHeader(b.companyId, id(bom.bomId), { rowVersion: bom.rowVersion, remarks: 'first' } as never, user);
    expect(await errorCode(boms.updateHeader(b.companyId, id(bom.bomId), { rowVersion: bom.rowVersion, remarks: 'second' } as never, user))).toBe(BOM_ERROR_CODES.ROW_VERSION_CONFLICT);
    expect(await errorCode(lines.addMain(b.companyId, id(bom.bomId), { componentItemId: b.msPipe, quantity: 1, rowVersion: bom.rowVersion } as never, user))).toBe(BOM_ERROR_CODES.ROW_VERSION_CONFLICT);
    await boms.remove(b.companyId, id(bom.bomId), user);
  });

  describe('release, revision, requirements (one BS500 BOM)', () => {
    let v1: Detail;

    it('requirements for 5 machines: END SHAFT TOP 10, END SHAFT BOTTOM 10, MS PIPE 10 (5 + 5)', async () => {
      v1 = await createBs500(b);
      const r = await boms.requirements(b.companyId, id(v1.bomId), { productionQuantity: 5 } as never);
      const totals = Object.fromEntries(r.totals.map((t) => [t.itemId, t.required]));
      expect(totals).toEqual({ [b.endShaftTop]: '10.000000', [b.endShaftBottom]: '10.000000', [b.msPipe]: '10.000000' });
    });

    it('release requires an Idempotency-Key; retry with the same key releases once; other body -> reused', async () => {
      expect(await errorCode(boms.release(b.companyId, id(v1.bomId), {} as never, user, undefined))).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const k = key();
      const released = (await boms.release(b.companyId, id(v1.bomId), {} as never, user, k)) as unknown as Detail;
      expect(released.status).toBe('RELEASED');
      expect(released.isCurrentVersion).toBe(true);
      const again = (await boms.release(b.companyId, id(v1.bomId), {} as never, user, k)) as unknown as Detail;
      expect(again.status).toBe('RELEASED');
      expect(await prisma.bomStatusHistory.count({ where: { bomId: id(v1.bomId), toStatus: 'RELEASED' } })).toBe(1);
      expect(await errorCode(boms.release(b.companyId, id(v1.bomId), { rowVersion: 1 } as never, user, k))).toBe('IDEMPOTENCY_KEY_REUSED');
      v1 = released;
    });

    it('released BOM is locked: header, MAIN, SUB, line edit -> BOM_LOCKED', async () => {
      const mainId = id(v1.groups[0].main.lineId);
      expect(await errorCode(boms.updateHeader(b.companyId, id(v1.bomId), { rowVersion: v1.rowVersion, remarks: 'x' } as never, user))).toBe(BOM_ERROR_CODES.BOM_LOCKED);
      expect(await errorCode(lines.addMain(b.companyId, id(v1.bomId), { componentItemId: b.boughtOut, quantity: 1 } as never, user))).toBe(BOM_ERROR_CODES.BOM_LOCKED);
      expect(await errorCode(lines.addSub(b.companyId, id(v1.bomId), mainId, { componentItemId: b.boughtOut, quantity: 1 } as never, user))).toBe(BOM_ERROR_CODES.BOM_LOCKED);
      expect(await errorCode(lines.updateLine(b.companyId, id(v1.bomId), mainId, { quantity: 3 } as never, user))).toBe(BOM_ERROR_CODES.BOM_LOCKED);
      expect(await errorCode(boms.remove(b.companyId, id(v1.bomId), user))).toBe(BOM_ERROR_CODES.INVALID_STATUS_TRANSITION);
    });

    it('a second standard BOM for the same item + type is refused (service and database)', async () => {
      expect(await errorCode(createBs500(b, { groups: [] }))).toBe(BOM_ERROR_CODES.PARENT_HAS_RELEASED_BOM);
      const v1Row = await prisma.bom.findUniqueOrThrow({ where: { bomId: id(v1.bomId) } });
      expect(
        await errorCode(
          prisma.bom.create({
            data: { companyId: b.companyId, bomNumber: 'RAWDUP', parentItemId: v1Row.parentItemId, bomType: v1Row.bomType, uomId: v1Row.uomId, status: 'RELEASED', isCurrentVersion: true },
          }),
        ),
      ).toBe('PRISMA_P2002');
    });

    it('renaming an item after release leaves the snapshot', async () => {
      await prisma.item.update({ where: { itemId: id(b.endShaftTop) }, data: { description: 'END SHAFT TOP - RENAMED' } });
      const after = (await boms.get(b.companyId, id(v1.bomId), user)) as unknown as Detail;
      expect(after.groups[0].subLines[0].itemName).toBe('END SHAFT TOP');
      await prisma.item.update({ where: { itemId: id(b.endShaftTop) }, data: { description: 'END SHAFT TOP' } });
    });

    let v2: Detail;

    it('revision: new DRAFT with the same keys and remapped parents; v1 untouched; new MAIN continues numbering', async () => {
      expect(await errorCode(boms.revise(b.companyId, id(v1.bomId), {} as never, user, key()))).toBe(BOM_ERROR_CODES.REVISION_REASON_REQUIRED);
      v2 = (await boms.revise(b.companyId, id(v1.bomId), { revisionReason: 'ECN-001 bearing change', revisionLabel: 'B' } as never, user, key())) as unknown as Detail;
      expect(v2.status).toBe('DRAFT');
      expect(v2.version).toBe(2);
      expect(v2.bomNumber).toBe(v1.bomNumber);
      expect(v2.groups.map((g) => g.commonKey)).toEqual(v1.groups.map((g) => g.commonKey));
      for (const g of v2.groups) {
        expect(g.main.lineId).not.toBe(v1.groups.find((o) => o.commonKey === g.commonKey)!.main.lineId);
        for (const s of g.subLines) expect(s.parentLineId).toBe(g.main.lineId);
      }
      const old = (await boms.get(b.companyId, id(v1.bomId), user)) as unknown as Detail;
      expect(old.status).toBe('RELEASED');
      expect(old.isCurrentVersion).toBe(true);
      expect(old.allowedActions).not.toContain('revise');
      expect(await errorCode(boms.revise(b.companyId, id(v1.bomId), { revisionReason: 'again' } as never, user, key()))).toBe(BOM_ERROR_CODES.OPEN_REVISION_EXISTS);

      const added = (await lines.addMain(b.companyId, id(v2.bomId), { componentItemId: b.boughtOut, quantity: 4 } as never, user)) as unknown as Detail;
      expect(added.groups.map((g) => g.commonKey)).toEqual(['1', '2', '3']);
      v2 = added;
    });

    it('release is transactional: an audit failure leaves v2 DRAFT, no snapshots, v1 still current', async () => {
      const spy = jest.spyOn(repository, 'writeAudit').mockImplementationOnce((() => {
        throw new Error('forced audit failure');
      }) as never);
      await expect(boms.release(b.companyId, id(v2.bomId), {} as never, user, key())).rejects.toThrow('forced audit failure');
      spy.mockRestore();
      const draft = await prisma.bom.findUniqueOrThrow({ where: { bomId: id(v2.bomId) } });
      expect(draft.status).toBe('DRAFT');
      expect(await prisma.bomLine.count({ where: { bomId: id(v2.bomId), itemCodeSnapshot: { not: null } } })).toBe(0);
      const old = await prisma.bom.findUniqueOrThrow({ where: { bomId: id(v1.bomId) } });
      expect(old.status).toBe('RELEASED');
      expect(old.isCurrentVersion).toBe(true);
    });

    it('releasing v2 makes v1 OBSOLETE; where-used and by-item follow the current version', async () => {
      const released = (await boms.release(b.companyId, id(v2.bomId), {} as never, user, key())) as unknown as Detail;
      expect(released.status).toBe('RELEASED');
      const old = await prisma.bom.findUniqueOrThrow({ where: { bomId: id(v1.bomId) } });
      expect(old.status).toBe('OBSOLETE');
      expect(old.isCurrentVersion).toBe(false);

      const used = await boms.whereUsed(b.companyId, { itemId: b.msPipe, includeDrafts: false } as never);
      expect(used.boms.map((x) => x.bomId)).toEqual([v2.bomId]);
      expect(used.boms[0].usages).toHaveLength(2);
      const current = (await boms.byItem(b.companyId, id(b.bs500), {} as never, user)) as unknown as Detail;
      expect(current.bomId).toBe(v2.bomId);

      const history = await boms.revisions(b.companyId, id(v2.bomId));
      expect((history.items as unknown as Array<{ version: number }>).map((h) => h.version)).toEqual([2, 1]);
    });

    it('obsolete needs a reason; cancel is only for DRAFT', async () => {
      expect(await errorCode(boms.obsolete(b.companyId, id(v2.bomId), {} as never, user, key()))).toBe(BOM_ERROR_CODES.REASON_REQUIRED);
      expect(await errorCode(boms.cancel(b.companyId, id(v2.bomId), { reason: 'x' } as never, user))).toBe(BOM_ERROR_CODES.INVALID_STATUS_TRANSITION);
      const gone = (await boms.obsolete(b.companyId, id(v2.bomId), { reason: 'Machine discontinued' } as never, user, key())) as unknown as Detail;
      expect(gone.status).toBe('OBSOLETE');
      expect(gone.allowedActions).toEqual(['requirements']);
    });
  });
});
