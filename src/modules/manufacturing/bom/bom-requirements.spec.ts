import { Prisma } from '@prisma/client';
import { computeRequirements, RequirementLineInput } from './bom-requirements';

const D = (v: string | number) => new Prisma.Decimal(v);
const line = (itemId: string, qty: string | number, scrap: string | number = 0): RequirementLineInput => ({
  lineId: `l-${itemId}-${qty}`,
  itemId,
  itemCode: itemId,
  itemName: itemId,
  uomCode: 'NOS',
  quantity: D(qty),
  scrapPercentage: D(scrap),
});

/** BS500: two roller assemblies, MS PIPE in both. */
const bs500 = [
  { commonKey: '1', main: line('TOP_ASSY', 1), subLines: [line('END_SHAFT_TOP', 2), line('MS_PIPE', 1)] },
  { commonKey: '2', main: line('BOTTOM_ASSY', 1), subLines: [line('END_SHAFT_BOTTOM', 2), line('MS_PIPE', 1)] },
];

describe('computeRequirements', () => {
  it('BS500 x 5: per group and flat totals (MS PIPE summed across groups)', () => {
    const r = computeRequirements({ productionQuantity: D(5), baseQuantity: D(1), groups: bs500 });
    expect(r.groups[0].main.required).toBe('5.000000');
    expect(r.groups[0].subLines.map((s) => [s.itemId, s.required])).toEqual([
      ['END_SHAFT_TOP', '10.000000'],
      ['MS_PIPE', '5.000000'],
    ]);
    expect(r.groups[1].subLines.map((s) => [s.itemId, s.required])).toEqual([
      ['END_SHAFT_BOTTOM', '10.000000'],
      ['MS_PIPE', '5.000000'],
    ]);
    const totals = Object.fromEntries(r.totals.map((t) => [t.itemId, t.required]));
    expect(totals).toEqual({ END_SHAFT_BOTTOM: '10.000000', END_SHAFT_TOP: '10.000000', MS_PIPE: '10.000000' });
    expect(r.totals.find((t) => t.itemId === 'MS_PIPE')!.usedIn).toEqual(['1', '2']);
    expect(r.assemblyTotals.map((t) => [t.itemId, t.required])).toEqual([
      ['BOTTOM_ASSY', '5.000000'],
      ['TOP_ASSY', '5.000000'],
    ]);
  });

  it('scrap and baseQuantity != 1 are exact (Decimal, no float drift)', () => {
    // MAIN = 3 x 1.5 x 1.10 / 2 = 2.475 ; SUB = 2.475 x 0.333333 x 1.025 = 0.845624154375
    const r = computeRequirements({
      productionQuantity: D(3),
      baseQuantity: D(2),
      groups: [{ commonKey: '1', main: line('A', '1.5', 10), subLines: [line('B', '0.333333', '2.5')] }],
    });
    expect(r.groups[0].main.required).toBe('2.475000');
    expect(r.groups[0].subLines[0].required).toBe('0.845624');
  });

  it('0.1 x 3 stays 0.3 exactly', () => {
    const r = computeRequirements({
      productionQuantity: D(3),
      baseQuantity: D(1),
      groups: [{ commonKey: '1', main: line('A', 1), subLines: [line('B', '0.1')] }],
    });
    expect(r.totals.find((t) => t.itemId === 'B')!.required).toBe('0.300000');
  });

  it('a MAIN without SUB lines is a material (counted in totals, not assemblies)', () => {
    const r = computeRequirements({
      productionQuantity: D(2),
      baseQuantity: D(1),
      groups: [{ commonKey: '7', main: line('SIDE_PLATE', 1), subLines: [] }],
    });
    expect(r.totals).toEqual([expect.objectContaining({ itemId: 'SIDE_PLATE', required: '2.000000' })]);
    expect(r.assemblyTotals).toEqual([]);
  });

  it('totals are summed before rounding', () => {
    const r = computeRequirements({
      productionQuantity: D(1),
      baseQuantity: D(1),
      groups: [
        { commonKey: '1', main: line('M1', 1), subLines: [line('X', '0.0000004')] },
        { commonKey: '2', main: line('M2', 1), subLines: [line('X', '0.0000004')] },
      ],
    });
    // each line rounds to 0.000000 but the sum 0.0000008 rounds to 0.000001
    expect(r.groups[0].subLines[0].required).toBe('0.000000');
    expect(r.totals.find((t) => t.itemId === 'X')!.required).toBe('0.000001');
  });
});
