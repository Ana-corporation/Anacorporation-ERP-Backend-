/** Canonical row values (strings as typed in the file or edited on the review screen). */
export type ImportRowData = Partial<
  Record<
    | 'store'
    | 'categoryCode'
    | 'partNumber'
    | 'partName'
    | 'partCode'
    | 'materialGrade'
    | 'size'
    | 'uom'
    | 'status'
    | 'locationCode'
    | 'binCode'
    | 'vendorCode'
    | 'quantity'
    | 'unitPrice'
    | 'batchNo'
    | 'serialNo'
    | 'revision'
    | 'remarks'
    | 'machineModel'
    | 'machineNo'
    | 'category',
    string
  >
>;

export interface ImportRowInput {
  rowNo: number;
  data: ImportRowData;
}

export interface ItemInfo {
  itemId: string;
  itemCode: string;
  /** null = can receive stock; otherwise the reason it cannot */
  blockedReason: string | null;
  /** Category code of the item (Item Group), null when none */
  categoryCode: string | null;
}

export interface EvaluationContext {
  stores: Array<{ id: string; name: string; codePrefix: string; numberSeriesCode: string | null }>;
  uoms: Array<{ id: string; code: string; name: string }>;
  warehouses: Array<{ id: string; code: string; isActive: boolean; binManagement: boolean; vendorId?: string | null }>;
  /** Sub Contractor store (Store Type SUBCONTRACTOR) - its code prefix / name work as Location Code */
  subcontractStores?: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  /** Vendors by uppercase vendor code */
  vendorsByCode?: Map<
    string,
    { id: string; code: string; name: string; isActive: boolean; isJobWorkVendor: boolean }
  >;
  /** `${storeId}|${vendorId}` → existing vendor location id */
  vendorLocations?: Map<string, string>;
  bins: Array<{ id: string; warehouseId: string; code: string; isActive: boolean }>;
  /** Categories (Item Groups) that have a category code */
  categories: Array<{ id: string; code: string; name: string; storeId: string; isActive: boolean }>;
  /** Live items of this company by uppercase item code */
  itemsByCode: Map<string, ItemInfo>;
  /** Live items by uppercase Old Code (drawing / previous PN). Multiple = ambiguous. */
  itemsByOldCode?: Map<string, ItemInfo[]>;
  /** `${itemId}|${warehouseId}|${storageBinId ?? ''}` that already have posted opening stock */
  openingPosted: Set<string>;
}

export interface RowError {
  field: string;
  message: string;
  /** How to fix it, when the system can tell */
  suggestion?: string;
}

export interface EvaluatedRow {
  rowNo: number;
  storeCategoryId: string | null;
  /** Category from the Category Code column */
  itemGroupId: string | null;
  uomId: string | null;
  uomCode: string | null;
  warehouseId: string | null;
  storageBinId: string | null;
  /** Sub Contractor rows: the store + vendor (the vendor location may not exist yet) */
  subcontractStoreId: string | null;
  vendorId: string | null;
  quantity: string | null;
  unitPrice: string | null;
  /** Every Part Number must already exist: a row is either MATCHED or ERROR. */
  matchStatus: 'MATCHED' | 'ERROR';
  matchedItemId: string | null;
  errors: RowError[];
}

/** Message for a Part Number that is not in this company's Item Master (the import never creates items). */
export const PART_NOT_FOUND_MESSAGE = 'Part Number not found. Create the item in Item Master first.';
export const PART_REQUIRED_MESSAGE = 'Part Number is required.';
export const AMBIGUOUS_OLD_CODE_MESSAGE = 'Ambiguous Old Code. More than one item uses this drawing number.';

const MAX_LENGTH: Partial<Record<keyof ImportRowData, number>> = {
  store: 100,
  categoryCode: 20,
  partNumber: 50,
  partName: 255,
  partCode: 80,
  materialGrade: 80,
  size: 80,
  uom: 40,
  status: 20,
  locationCode: 80,
  binCode: 40,
  vendorCode: 40,
  batchNo: 60,
  serialNo: 80,
  revision: 40,
  remarks: 255,
  machineModel: 120,
  machineNo: 120,
  category: 120,
};

const text = (value: string | undefined) => (value ?? '').trim();
const lower = (value: string | undefined | null) => (value ?? '').trim().toLowerCase();

/** "Bought-Out Store" and "bought out" compare equal. */
export function normalizeStoreName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/store$/, '');
}

/**
 * Decimal string with up to 12 integer and 6 fraction digits (no float rounding).
 * Accepts "1,250.50". Returns null when blank.
 */
export function parseDecimal(raw: string | undefined): { value: string | null; error?: string } {
  const value = text(raw).replace(/,/g, '');
  if (!value) return { value: null };
  if (value.startsWith('-')) return { value: null, error: 'must not be negative' };
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value)) return { value: null, error: 'must be a number (up to 6 decimals)' };
  return { value };
}

/** Qty × Unit Price as a decimal string (6 decimals), computed without floats. */
export function multiplyDecimals(a: string | null, b: string | null): string {
  if (!a || !b) return '0';
  const scale = 1_000_000n;
  const toUnits = (v: string) => {
    const [int, frac = ''] = v.split('.');
    return BigInt(int) * scale + BigInt((frac + '000000').slice(0, 6));
  };
  const product = (toUnits(a) * toUnits(b)) / scale;
  const int = product / scale;
  const frac = (product % scale).toString().padStart(6, '0');
  return `${int}.${frac}`;
}

export function evaluateRows(rows: ImportRowInput[], ctx: EvaluationContext): EvaluatedRow[] {
  const storeByKey = new Map<string, string>();
  for (const s of ctx.stores) {
    storeByKey.set(normalizeStoreName(s.name), s.id);
    storeByKey.set(s.codePrefix.toLowerCase(), s.id);
    if (s.numberSeriesCode) storeByKey.set(s.numberSeriesCode.toLowerCase(), s.id);
  }
  const uomByKey = new Map<string, { id: string; code: string }>();
  for (const u of ctx.uoms) {
    uomByKey.set(u.code.toLowerCase(), u);
    uomByKey.set(u.name.toLowerCase(), u);
  }
  const warehouseByCode = new Map(ctx.warehouses.map((w) => [w.code.toLowerCase(), w]));
  const binByKey = new Map(ctx.bins.map((b) => [`${b.warehouseId}|${b.code.toLowerCase()}`, b]));
  const categoryByCode = new Map(ctx.categories.map((c) => [c.code.toUpperCase(), c]));

  const results = rows.map((row) => evaluateOne(row, ctx, storeByKey, uomByKey, warehouseByCode, binByKey, categoryByCode));
  markDuplicates(rows, results);
  for (const r of results) {
    if (r.errors.length > 0) r.matchStatus = 'ERROR';
  }
  return results;
}

function evaluateOne(
  row: ImportRowInput,
  ctx: EvaluationContext,
  storeByKey: Map<string, string>,
  uomByKey: Map<string, { id: string; code: string }>,
  warehouseByCode: Map<string, EvaluationContext['warehouses'][number]>,
  binByKey: Map<string, EvaluationContext['bins'][number]>,
  categoryByCode: Map<string, EvaluationContext['categories'][number]>,
): EvaluatedRow {
  const d = row.data;
  const errors: RowError[] = [];
  const add = (field: string, message: string, suggestion?: string) =>
    errors.push(suggestion ? { field, message, suggestion } : { field, message });

  for (const [field, max] of Object.entries(MAX_LENGTH) as Array<[keyof ImportRowData, number]>) {
    if (text(d[field]).length > max) add(field, `Too long (max ${max} characters)`);
  }

  // Category
  let category: EvaluationContext['categories'][number] | null = null;
  if (text(d.categoryCode)) {
    category = categoryByCode.get(text(d.categoryCode).toUpperCase()) ?? null;
    if (!category) {
      add('categoryCode', `Unknown category code "${text(d.categoryCode)}"`, `Use one of: ${[...categoryByCode.keys()].slice(0, 12).join(', ')}`);
    } else if (!category.isActive) add('categoryCode', `Category ${category.code} (${category.name}) is inactive`);
  }

  // Store category (reference; checked when given)
  let storeCategoryId: string | null = null;
  if (text(d.store)) {
    storeCategoryId = storeByKey.get(normalizeStoreName(text(d.store))) ?? storeByKey.get(lower(d.store)) ?? null;
    if (!storeCategoryId) add('store', `Unknown store "${text(d.store)}"`);
    else if (category && category.storeId !== storeCategoryId) add('store', `Category ${category.code} belongs to another store`);
  } else if (category) {
    storeCategoryId = category.storeId;
  }

  // Numbers
  let quantity: string | null = null;
  const qty = parseDecimal(d.quantity);
  if (qty.error) add('quantity', `Qty ${qty.error}`);
  else if (!qty.value) add('quantity', 'Qty is required');
  else if (Number(qty.value) <= 0) add('quantity', 'Qty must be greater than 0');
  else quantity = qty.value;

  const price = parseDecimal(d.unitPrice);
  if (price.error) add('unitPrice', `Unit Price ${price.error}`);
  const unitPrice = price.error ? null : (price.value ?? '0');

  // UOM
  let uom: { id: string; code: string } | null = null;
  if (text(d.uom)) {
    uom = uomByKey.get(lower(d.uom)) ?? null;
    if (!uom) add('uom', `Unknown UOM "${text(d.uom)}"`);
  }

  // Location = Inventory Location code; Bin from the Bin column (legacy "CODE/BIN" still accepted)
  let warehouseId: string | null = null;
  let storageBinId: string | null = null;
  let subcontractStoreId: string | null = null;
  let vendorId: string | null = null;
  const locationText = text(d.locationCode);
  const vendorCode = text(d.vendorCode);
  const subStore = locationText
    ? ctx.subcontractStores?.find((s) => s.code.toLowerCase() === locationText.toLowerCase() || s.name.toLowerCase() === locationText.toLowerCase())
    : undefined;
  if (!locationText) add('locationCode', 'Location Code is required');
  else if (subStore) {
    // Sub Contractor store: no bin, Vendor Code required; the vendor's location is made on approve if missing.
    if (!subStore.isActive) add('locationCode', `${subStore.name} is inactive`);
    if (text(d.binCode)) add('binCode', 'The Sub Contractor store never uses bins', 'Leave Bin empty');
    if (!vendorCode) add('vendorCode', 'Vendor Code is required for the Sub Contractor store', 'Use the vendor code from Vendor Master');
    else {
      const vendor = ctx.vendorsByCode?.get(vendorCode.toUpperCase());
      if (!vendor) add('vendorCode', `Unknown vendor "${vendorCode}"`, 'Use a Vendor Master code of this company');
      else if (!vendor.isActive) add('vendorCode', `Vendor ${vendor.code} is inactive`);
      else if (!vendor.isJobWorkVendor) {
        add(
          'vendorCode',
          `Vendor ${vendor.code} is not a job-work vendor`,
          'Mark Is Job Work Vendor on the vendor, then retry',
        );
      } else if (subStore.isActive) {
        subcontractStoreId = subStore.id;
        vendorId = vendor.id;
        warehouseId = ctx.vendorLocations?.get(`${subStore.id}|${vendor.id}`) ?? null;
      }
    }
  } else if (vendorCode && !warehouseByCode.get(locationText.toLowerCase())?.vendorId) {
    add('vendorCode', 'Vendor Code is only for the Sub Contractor store', 'Leave Vendor Code empty');
  } else {
    let warehouse = warehouseByCode.get(locationText.toLowerCase());
    let binCode: string | null = text(d.binCode) || null;
    if (!warehouse && locationText.includes('/')) {
      const cut = locationText.indexOf('/');
      warehouse = warehouseByCode.get(locationText.slice(0, cut).trim().toLowerCase());
      binCode = binCode ?? locationText.slice(cut + 1).trim();
    }
    const binsOf = (id: string) =>
      ctx.bins.filter((b) => b.warehouseId === id && b.isActive).slice(0, 5).map((b) => b.code).join(', ');
    if (!warehouse) add('locationCode', `Unknown location "${locationText}"`, 'Use an Inventory Location code from Inventory Setup (location only, bin in the Bin column)');
    else if (!warehouse.isActive) add('locationCode', `Location ${warehouse.code} is inactive`);
    else if (warehouse.binManagement && !binCode) {
      add('binCode', `${warehouse.code} uses bins; Bin is required`, binsOf(warehouse.id) ? `Bins of ${warehouse.code}: ${binsOf(warehouse.id)}` : undefined);
    } else if (!warehouse.binManagement && binCode) add('binCode', `${warehouse.code} does not use bins`, 'Leave Bin empty');
    else {
      warehouseId = warehouse.id;
      if (binCode) {
        const bin = binByKey.get(`${warehouse.id}|${binCode.toLowerCase()}`);
        if (!bin) add('binCode', `Bin ${binCode} not found in ${warehouse.code}`, binsOf(warehouse.id) ? `Bins of ${warehouse.code}: ${binsOf(warehouse.id)}` : undefined);
        else if (!bin.isActive) add('binCode', `Bin ${binCode} is inactive`);
        else storageBinId = bin.id;
      }
    }
  }

  // Part Number or Old Code: must exist in Item Master (the import never creates items)
  let matchedItemId: string | null = null;
  const partNumber = text(d.partNumber).toUpperCase();
  if (!partNumber) add('partNumber', PART_REQUIRED_MESSAGE);
  else {
    let item = ctx.itemsByCode.get(partNumber) ?? null;
    if (!item) {
      const byOld = ctx.itemsByOldCode?.get(partNumber) ?? [];
      if (byOld.length > 1) add('partNumber', AMBIGUOUS_OLD_CODE_MESSAGE, 'Use the ERP Item Code instead');
      else if (byOld.length === 1) item = byOld[0];
    }
    if (!item) add('partNumber', PART_NOT_FOUND_MESSAGE);
    else {
      matchedItemId = item.itemId;
      if (item.blockedReason) add('partNumber', `${item.itemCode} ${item.blockedReason}`);
      if (category && item.categoryCode && category.code.toUpperCase() !== item.categoryCode.toUpperCase()) {
        add(
          'categoryCode',
          `Category Code ${category.code} does not match item category ${item.categoryCode}`,
          `Category of ${item.itemCode} is ${item.categoryCode}`,
        );
      }
      if (warehouseId && ctx.openingPosted.has(`${matchedItemId}|${warehouseId}|${storageBinId ?? ''}`)) {
        add('locationCode', `Opening stock for ${item.itemCode} at this location is already posted`, 'Use Stock Adjustment to change it');
      }
    }
  }

  return {
    rowNo: row.rowNo,
    storeCategoryId,
    itemGroupId: category?.id ?? null,
    uomId: uom?.id ?? null,
    uomCode: uom?.code ?? null,
    warehouseId,
    storageBinId,
    subcontractStoreId,
    vendorId,
    quantity,
    unitPrice,
    matchStatus: matchedItemId ? 'MATCHED' : 'ERROR',
    matchedItemId,
    errors,
  };
}

/** Same item (Part Number) + location + bin + vendor + batch + serial twice in the file. */
function markDuplicates(rows: ImportRowInput[], results: EvaluatedRow[]) {
  const firstSeen = new Map<string, number>();
  results.forEach((r, i) => {
    const d = rows[i].data;
    if (!text(d.partNumber)) return;
    const place = r.warehouseId ?? (r.vendorId ? `v${r.subcontractStoreId}:${r.vendorId}` : lower(d.locationCode));
    const key = `${lower(d.partNumber)}|${place}|${r.storageBinId ?? lower(d.binCode)}|${lower(d.vendorCode)}|${lower(d.batchNo)}|${lower(d.serialNo)}`;
    const first = firstSeen.get(key);
    if (first === undefined) {
      firstSeen.set(key, r.rowNo);
      return;
    }
    r.errors.push({
      field: 'partNumber',
      message: text(d.vendorCode)
        ? `Duplicate of row ${first} (same part at vendor ${text(d.vendorCode)})`
        : `Duplicate of row ${first} (same part and location)`,
    });
  });
}

/** Letters / digits only, single spaces, lowercase: "M.S. Pipe 25NB" → "m s pipe 25nb". */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function bigrams(value: string): Map<string, number> {
  const s = value.replace(/ /g, '');
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice similarity of two names / codes on character pairs (0 = nothing in common, 1 = same). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ga = bigrams(x);
  const gb = bigrams(y);
  let total = 0;
  let common = 0;
  for (const n of ga.values()) total += n;
  for (const [g, n] of gb) {
    total += n;
    common += Math.min(n, ga.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * common) / total;
}
