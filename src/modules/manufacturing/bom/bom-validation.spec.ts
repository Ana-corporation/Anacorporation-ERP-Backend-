import { Prisma } from '@prisma/client';
import { BOM_ERROR_CODES, BOM_WARNING_CODES } from './bom.constants';
import { buildGroups, compareCommonKeys } from './bom-groups';
import { ValidationItem, ValidationLine, validateBom } from './bom-validation';

const D = (v: string | number) => new Prisma.Decimal(v);
const item = (id: string, extra: Partial<ValidationItem> = {}): ValidationItem => ({
  itemId: id,
  itemCode: `C${id}`,
  isActive: true,
  status: 'active',
  inventoryUomId: '1',
  ...extra,
});

let nextId = 100n;
function main(key: string, itemId: string, qty: string | number = 1): ValidationLine {
  return { bomLineId: nextId++, lineType: 'MAIN', commonKey: key, parentLineId: null, lineNumber: Number(nextId) * 10, componentItemId: itemId, quantity: D(qty), scrapPercentage: D(0), uomId: '1' };
}
function sub(of: ValidationLine, itemId: string, qty: string | number = 1, key = of.commonKey): ValidationLine {
  return { bomLineId: nextId++, lineType: 'SUB', commonKey: key, parentLineId: of.bomLineId, lineNumber: Number(nextId) * 10, componentItemId: itemId, quantity: D(qty), scrapPercentage: D(0), uomId: '1' };
}

const items = new Map(['1', '2', '3', '4', '5', '6'].map((id) => [id, item(id)]));
const procurement = (make: string[] = ['1', '2', '3'], hasField = true) => ({
  hasField,
  byItemId: new Map([...items.keys()].map((id) => [id, make.includes(id) ? 'Make' : 'Buy'])),
});
const header = { parentItemId: '1', uomId: '1', baseQuantity: D(1), version: 1, revisionReason: null, effectiveFrom: null, effectiveTo: null };
const codes = (list: Array<{ code: string }>) => list.map((i) => i.code);

describe('validateBom', () => {
  it('BS500 shape is valid; the same item in two groups is allowed', () => {
    const top = main('1', '2');
    const bottom = main('2', '3');
    const r = validateBom({ mode: 'release', header, items, procurement: procurement(), lines: [top, sub(top, '4', 2), sub(top, '5'), bottom, sub(bottom, '6', 2), sub(bottom, '5')] });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('same item twice in one group -> DUPLICATE_COMPONENT', () => {
    const top = main('1', '2');
    const r = validateBom({ mode: 'draft', header, items, procurement: procurement(), lines: [top, sub(top, '5'), sub(top, '5')] });
    expect(codes(r.errors)).toEqual([BOM_ERROR_CODES.DUPLICATE_COMPONENT]);
    expect(r.errors[0].field).toBe('groups.0.subLines.1.componentItemId');
  });

  it('parent machine as MAIN or SUB, or SUB = its MAIN item -> SELF_REFERENCE', () => {
    const asMain = main('1', '1');
    const top = main('2', '2');
    const r = validateBom({ mode: 'draft', header, items, procurement: procurement(), lines: [asMain, top, sub(top, '1'), sub(top, '2')] });
    expect(codes(r.errors)).toEqual([BOM_ERROR_CODES.SELF_REFERENCE, BOM_ERROR_CODES.SELF_REFERENCE, BOM_ERROR_CODES.SELF_REFERENCE]);
  });

  it('release needs at least one MAIN', () => {
    expect(codes(validateBom({ mode: 'release', header, items, procurement: procurement(), lines: [] }).errors)).toEqual([BOM_ERROR_CODES.LINES_REQUIRED]);
    expect(validateBom({ mode: 'draft', header, items, procurement: procurement(), lines: [] }).valid).toBe(true);
  });

  it('inactive component: warning on a draft, error on release', () => {
    const inactive = new Map(items).set('5', item('5', { isActive: false }));
    const top = main('1', '2');
    const lines = [top, sub(top, '5')];
    const draft = validateBom({ mode: 'draft', header, items: inactive, procurement: procurement(), lines });
    expect(draft.errors).toEqual([]);
    expect(codes(draft.warnings)).toContain(BOM_WARNING_CODES.COMPONENT_INACTIVE);
    expect(codes(validateBom({ mode: 'release', header, items: inactive, procurement: procurement(), lines }).errors)).toEqual([BOM_ERROR_CODES.COMPONENT_INACTIVE]);
  });

  it('parent must be Make / Subcontract when the company has the field; skipped otherwise', () => {
    const top = main('1', '2');
    const lines = [top, sub(top, '5')];
    expect(codes(validateBom({ mode: 'draft', header, items, procurement: procurement(['2']), lines }).errors)).toEqual([BOM_ERROR_CODES.PARENT_NOT_MAKE_ITEM]);
    expect(validateBom({ mode: 'draft', header, items, procurement: procurement([], false), lines }).valid).toBe(true);
  });

  it('MAIN without SUB lines warns only when the MAIN item is Make', () => {
    const assy = main('1', '2'); // Make
    const plate = main('2', '5'); // Buy single part
    const r = validateBom({ mode: 'draft', header, items, procurement: procurement(), lines: [assy, plate] });
    expect(r.warnings.filter((w) => w.code === BOM_WARNING_CODES.MAIN_WITHOUT_SUB_LINES).map((w) => w.field)).toEqual(['groups.0.main']);
  });

  it('quantity <= 0 and scrap > 100 are rejected', () => {
    const top = main('1', '2', 0);
    const bad = sub(top, '5', -1);
    bad.scrapPercentage = D(101);
    const r = validateBom({ mode: 'draft', header, items, procurement: procurement(), lines: [top, bad] });
    expect(codes(r.errors)).toEqual([BOM_ERROR_CODES.QTY_MUST_BE_POSITIVE, BOM_ERROR_CODES.QTY_MUST_BE_POSITIVE, BOM_ERROR_CODES.SCRAP_OUT_OF_RANGE]);
  });

  it('SUB without its MAIN / with another key is reported', () => {
    const top = main('1', '2');
    const orphan: ValidationLine = { ...sub(top, '5'), parentLineId: 999999n, commonKey: '9' };
    const wrongKey = sub(top, '6', 1, '77');
    const r = validateBom({ mode: 'draft', header, items, procurement: procurement(), lines: [top, wrongKey, orphan] });
    expect(codes(r.errors).sort()).toEqual([BOM_ERROR_CODES.MAIN_LINE_NOT_FOUND, BOM_ERROR_CODES.SUB_PARENT_MUST_BE_MAIN].sort());
  });

  it('component missing (e.g. another company) -> COMPONENT_NOT_FOUND; UOM must be the item UOM', () => {
    const top = main('1', '2');
    const foreign = sub(top, '999');
    const otherUom = sub(top, '4');
    otherUom.uomId = '2';
    const r = validateBom({ mode: 'draft', header, items, procurement: procurement(), lines: [top, foreign, otherUom] });
    expect(codes(r.errors)).toEqual([BOM_ERROR_CODES.COMPONENT_NOT_FOUND, BOM_ERROR_CODES.UOM_INVALID]);
  });

  it('revision needs a reason; effective dates must be in order', () => {
    const r = validateBom({
      mode: 'draft',
      header: { ...header, version: 2, effectiveFrom: new Date('2026-12-01'), effectiveTo: new Date('2026-11-01') },
      items,
      procurement: procurement(),
      lines: [],
    });
    expect(codes(r.errors)).toEqual([BOM_ERROR_CODES.EFFECTIVE_DATE_INVALID, BOM_ERROR_CODES.REVISION_REASON_REQUIRED]);
  });
});

describe('buildGroups', () => {
  it('orders by numeric Common Key and attaches SUB lines by parentLineId', () => {
    const k10 = main('10', '2');
    const k2 = main('2', '3');
    const s = sub(k10, '5');
    const groups = buildGroups([k10, s, k2]);
    expect(groups.map((g) => g.commonKey)).toEqual(['2', '10']);
    expect(groups[1].subLines.map((l) => l.bomLineId)).toEqual([s.bomLineId]);
  });

  it('compareCommonKeys: numbers numerically, text after', () => {
    expect(['10', 'A', '2', '1'].sort(compareCommonKeys)).toEqual(['1', '2', '10', 'A']);
  });
});
