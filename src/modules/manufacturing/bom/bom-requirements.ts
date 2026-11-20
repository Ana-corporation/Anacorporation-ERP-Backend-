import { Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const HUNDRED = D(100);

export interface RequirementLineInput {
  lineId: string;
  itemId: string;
  itemCode: string;
  oldCode?: string | null;
  itemName: string;
  uomCode: string;
  quantity: Decimal;
  scrapPercentage: Decimal;
  findNumber?: string | null;
}

export interface RequirementGroupInput {
  commonKey: string;
  main: RequirementLineInput;
  subLines: RequirementLineInput[];
}

export interface RequiredLine extends Omit<RequirementLineInput, 'quantity' | 'scrapPercentage'> {
  quantityPer: string;
  scrapPercentage: string;
  required: string;
}

export interface RequiredTotal {
  itemId: string;
  itemCode: string;
  oldCode: string | null;
  itemName: string;
  uomCode: string;
  required: string;
  usedIn: string[];
}

/** Output scale: quantities are DECIMAL(19,6). Totals are summed before rounding. */
const SCALE = 6;
const out = (d: Decimal) => d.toDecimalPlaces(SCALE, Prisma.Decimal.ROUND_HALF_UP).toFixed(SCALE);
const withScrap = (qty: Decimal, scrap: Decimal) => qty.mul(D(1).add(scrap.div(HUNDRED)));

type Tally = Map<string, { line: RequirementLineInput; required: Decimal; usedIn: Set<string> }>;

function toTotals(tally: Tally): RequiredTotal[] {
  return [...tally.values()]
    .map((t) => ({
      itemId: t.line.itemId,
      itemCode: t.line.itemCode,
      oldCode: t.line.oldCode ?? null,
      itemName: t.line.itemName,
      uomCode: t.line.uomCode,
      required: out(t.required),
      usedIn: [...t.usedIn],
    }))
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}

/**
 * MAIN required = productionQty x mainQty x (1 + mainScrap/100) / baseQty
 * SUB  required = MAIN required x subQty x (1 + subScrap/100)
 * Decimal only. `totals` = materials to provide: every SUB line plus MAIN lines without SUB lines
 * (single parts under the machine); the same item in several groups is added up.
 * `assemblyTotals` = MAIN lines that have SUB lines (built from those SUBs, so not counted twice).
 */
export function computeRequirements(params: {
  productionQuantity: Decimal;
  baseQuantity: Decimal;
  groups: RequirementGroupInput[];
}) {
  const { productionQuantity, baseQuantity, groups } = params;
  const materials: Tally = new Map();
  const assemblies: Tally = new Map();
  const add = (tally: Tally, line: RequirementLineInput, required: Decimal, key: string) => {
    const t = tally.get(line.itemId) ?? { line, required: D(0), usedIn: new Set<string>() };
    t.required = t.required.add(required);
    t.usedIn.add(key);
    tally.set(line.itemId, t);
  };
  const strip = ({ quantity, scrapPercentage, ...rest }: RequirementLineInput, required: Decimal): RequiredLine => ({
    ...rest,
    quantityPer: quantity.toFixed(SCALE),
    scrapPercentage: scrapPercentage.toFixed(4),
    required: out(required),
  });

  const resultGroups = groups.map((g) => {
    const mainRequired = withScrap(productionQuantity.mul(g.main.quantity), g.main.scrapPercentage).div(baseQuantity);
    add(g.subLines.length ? assemblies : materials, g.main, mainRequired, g.commonKey);
    const subLines = g.subLines.map((s) => {
      const required = withScrap(mainRequired.mul(s.quantity), s.scrapPercentage);
      add(materials, s, required, g.commonKey);
      return strip(s, required);
    });
    return { commonKey: g.commonKey, main: strip(g.main, mainRequired), subLines };
  });

  return {
    productionQuantity: productionQuantity.toFixed(SCALE),
    baseQuantity: baseQuantity.toFixed(SCALE),
    groups: resultGroups,
    totals: toTotals(materials),
    assemblyTotals: toTotals(assemblies),
  };
}
