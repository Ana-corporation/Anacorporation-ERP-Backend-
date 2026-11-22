import {
  EvaluationContext,
  ImportRowInput,
  PART_NOT_FOUND_MESSAGE,
  PART_REQUIRED_MESSAGE,
  evaluateRows,
  multiplyDecimals,
  nameSimilarity,
  normalizeStoreName,
  parseDecimal,
} from './opening-stock-import.evaluator';

const item = (itemId: string, itemCode: string, blockedReason: string | null = null, categoryCode: string | null = null) => ({
  itemId,
  itemCode,
  blockedReason,
  categoryCode,
});

function ctx(over: Partial<EvaluationContext> = {}): EvaluationContext {
  const items = [item('1', 'ANABO00001', null, 'BRG'), item('2', 'ANABO00002'), item('3', 'ANABO00003', 'is inactive')];
  return {
    stores: [
      { id: '10', name: 'Bought-Out Store', codePrefix: 'BOS', numberSeriesCode: 'BO' },
      { id: '11', name: 'Finished Goods Store', codePrefix: 'FGS', numberSeriesCode: null },
    ],
    uoms: [{ id: '20', code: 'NOS', name: 'Numbers' }],
    warehouses: [
      { id: '30', code: 'BOS-001', isActive: true, binManagement: false },
      { id: '31', code: 'BOS-002', isActive: true, binManagement: true },
    ],
    bins: [{ id: '40', warehouseId: '31', code: 'A-01', isActive: true }],
    categories: [
      { id: '60', code: 'BRG', name: 'Bearings', storeId: '10', isActive: true },
      { id: '61', code: 'BLT', name: 'Belts', storeId: '10', isActive: true },
    ],
    itemsByCode: new Map(items.map((i) => [i.itemCode, i])),
    openingPosted: new Set(['2|30|']),
    ...over,
  };
}

let rowNo = 1;
const row = (data: ImportRowInput['data']): ImportRowInput => ({
  rowNo: ++rowNo,
  data: { locationCode: 'BOS-001', quantity: '5', unitPrice: '10', ...data },
});

describe('opening stock import helpers', () => {
  it('parses decimals without floats and rejects bad / negative values', () => {
    expect(parseDecimal('1,250.50')).toEqual({ value: '1250.50' });
    expect(parseDecimal('')).toEqual({ value: null });
    expect(parseDecimal('-1').error).toMatch(/negative/);
    expect(parseDecimal('abc').error).toMatch(/number/);
  });

  it('Total Price = Qty × Unit Price', () => {
    expect(multiplyDecimals('3', '100')).toBe('300.000000');
    expect(multiplyDecimals('2.5', '0.333333')).toBe('0.833332');
    expect(multiplyDecimals(null, '5')).toBe('0');
  });

  it('matches store names loosely', () => {
    expect(normalizeStoreName('Bought-Out Store')).toBe(normalizeStoreName('bought out'));
  });

  it('name / code similarity for "Did you mean ...?"', () => {
    expect(nameSimilarity('MS PIPE 25NB', 'M.S. Pipe 25 NB')).toBeGreaterThan(0.9);
    expect(nameSimilarity('ANARM0012', 'ANARM00012')).toBeGreaterThan(0.75);
    expect(nameSimilarity('Bearing 6204', 'Hydraulic oil')).toBeLessThan(0.3);
  });
});

describe('evaluateRows (Part Number must exist; no item creation)', () => {
  it('existing Part Number (any case) → MATCHED', () => {
    const [a] = evaluateRows([row({ partNumber: 'anabo00001' })], ctx());
    expect(a).toMatchObject({ matchStatus: 'MATCHED', matchedItemId: '1', warehouseId: '30', errors: [] });
  });

  it('unknown Part Number → ERROR "Create the item in Item Master first"; empty → "Part Number is required."', () => {
    const [unknown, empty, sf, ff] = evaluateRows(
      [
        row({ partNumber: 'NOPE01' }),
        row({ partName: 'Gear without part number', uom: 'NOS' }),
        row({ partNumber: 'ANASF99999', categoryCode: 'SF' }),
        row({ partNumber: 'ANAFF99999' }),
      ],
      ctx(),
    );
    expect(unknown).toMatchObject({ matchStatus: 'ERROR', matchedItemId: null });
    expect(unknown.errors[0]).toMatchObject({ field: 'partNumber', message: PART_NOT_FOUND_MESSAGE });
    expect(empty.errors.find((e) => e.field === 'partNumber')).toMatchObject({ message: PART_REQUIRED_MESSAGE });
    expect(empty.matchStatus).toBe('ERROR');
    expect(sf.errors.some((e) => e.message === PART_NOT_FOUND_MESSAGE)).toBe(true);
    expect(ff.errors.some((e) => e.message === PART_NOT_FOUND_MESSAGE)).toBe(true);
  });

  it('Part Number of another company is never matched (only this company\'s items are in the context)', () => {
    const [other] = evaluateRows([row({ partNumber: 'OTHERCO-01' })], ctx());
    expect(other.errors[0].message).toBe(PART_NOT_FOUND_MESSAGE);
  });

  it('Category Code must match the item category', () => {
    const [ok, wrong] = evaluateRows(
      [row({ partNumber: 'ANABO00001', categoryCode: 'BRG' }), row({ partNumber: 'ANABO00001', categoryCode: 'BLT', locationCode: 'BOS-002', binCode: 'A-01' })],
      ctx(),
    );
    expect(ok.matchStatus).toBe('MATCHED');
    expect(wrong.errors[0]).toMatchObject({ field: 'categoryCode', message: expect.stringMatching(/does not match item category BRG/) });
  });

  it('unknown UOM / bad qty are row errors; other rows stay valid', () => {
    const results = evaluateRows(
      [row({ partNumber: 'ANABO00001', uom: 'BOX' }), row({ partNumber: 'ANABO00002', quantity: '-2', locationCode: 'BOS-002', binCode: 'A-01' }), row({ partNumber: 'ANABO00001', locationCode: 'BOS-002', binCode: 'A-01' })],
      ctx({ openingPosted: new Set() }),
    );
    expect(results.map((r) => r.matchStatus)).toEqual(['ERROR', 'ERROR', 'MATCHED']);
    expect(results[0].errors[0]).toMatchObject({ field: 'uom' });
  });

  it('blocked items, already posted opening stock, unknown store / location, bins', () => {
    const results = evaluateRows(
      [
        row({ partNumber: 'ANABO00003' }),
        row({ partNumber: 'ANABO00002' }),
        row({ partNumber: 'ANABO00001', store: 'Nowhere' }),
        row({ partNumber: 'ANABO00001', locationCode: 'BOS-002' }),
      ],
      ctx(),
    );
    expect(results.every((r) => r.matchStatus === 'ERROR')).toBe(true);
    expect(results[0].errors[0].message).toMatch(/inactive/);
    expect(results[1].errors[0].message).toMatch(/already posted/);
    expect(results[2].errors[0].field).toBe('store');
    expect(results[3].errors[0].message).toMatch(/uses bins/);
  });

  it('Bin column with the location code; legacy CODE/BIN still works', () => {
    const [withColumn, legacy, missing, foreign] = evaluateRows(
      [
        row({ partNumber: 'ANABO00001', locationCode: 'BOS-002', binCode: 'a-01' }),
        row({ partNumber: 'ANABO00002', locationCode: 'BOS-002/A-01' }),
        row({ partNumber: 'ANABO00001', locationCode: 'BOS-002', batchNo: 'H2' }),
        row({ partNumber: 'ANABO00001', locationCode: 'BOS-001', binCode: 'A-01', batchNo: 'H3' }),
      ],
      ctx({ openingPosted: new Set() }),
    );
    expect(withColumn).toMatchObject({ matchStatus: 'MATCHED', warehouseId: '31', storageBinId: '40' });
    expect(legacy).toMatchObject({ matchStatus: 'MATCHED', storageBinId: '40' });
    expect(missing.errors[0]).toMatchObject({ field: 'binCode', suggestion: expect.stringMatching(/A-01/) });
    expect(foreign.errors[0]).toMatchObject({ field: 'binCode', message: expect.stringMatching(/does not use bins/) });
  });

  it('duplicates: same part + location + bin + batch twice; different batches are fine', () => {
    const results = evaluateRows(
      [
        row({ partNumber: 'ANABO00001', batchNo: 'H1' }),
        row({ partNumber: 'ANABO00001', batchNo: 'H2' }),
        row({ partNumber: 'anabo00001', batchNo: 'h1' }),
      ],
      ctx(),
    );
    expect(results.map((r) => r.matchStatus)).toEqual(['MATCHED', 'MATCHED', 'ERROR']);
    expect(results[2].errors[0].message).toMatch(/Duplicate of row/);
  });

  it('Sub Contractor store: Vendor Code required / valid / active job-work, no bin; vendor not allowed elsewhere', () => {
    const c = ctx({
      subcontractStores: [{ id: '90', code: 'SUB', name: 'Sub Contractor Store', isActive: true }],
      vendorsByCode: new Map([
        ['JW-1', { id: '501', code: 'JW-1', name: 'Cutting Works', isActive: true, isJobWorkVendor: true }],
        ['JW-2', { id: '502', code: 'JW-2', name: 'Normal Vendor', isActive: true, isJobWorkVendor: false }],
        ['JW-3', { id: '503', code: 'JW-3', name: 'Old Vendor', isActive: false, isJobWorkVendor: true }],
      ]),
      vendorLocations: new Map([['90|501', '77']]),
    });
    const [ok, missing, unknown, inactive, notJob, withBin, elsewhere, dupe] = evaluateRows(
      [
        row({ partNumber: 'ANABO00001', locationCode: 'sub', vendorCode: 'jw-1' }),
        row({ partNumber: 'ANABO00001', locationCode: 'SUB', batchNo: 'B2' }),
        row({ partNumber: 'ANABO00001', locationCode: 'SUB', vendorCode: 'NOPE', batchNo: 'B3' }),
        row({ partNumber: 'ANABO00001', locationCode: 'SUB', vendorCode: 'JW-3', batchNo: 'B4' }),
        row({ partNumber: 'ANABO00001', locationCode: 'SUB', vendorCode: 'JW-2', batchNo: 'B4b' }),
        row({ partNumber: 'ANABO00001', locationCode: 'SUB', vendorCode: 'JW-1', binCode: 'A-01', batchNo: 'B5' }),
        row({ partNumber: 'ANABO00001', locationCode: 'BOS-001', vendorCode: 'JW-1' }),
        row({ partNumber: 'ANABO00001', locationCode: 'SUB', vendorCode: 'JW-1' }),
      ],
      c,
    );
    expect(ok).toMatchObject({ matchStatus: 'MATCHED', subcontractStoreId: '90', vendorId: '501', warehouseId: '77' });
    expect(missing.errors[0]).toMatchObject({ field: 'vendorCode', message: expect.stringMatching(/required/) });
    expect(unknown.errors[0]).toMatchObject({ field: 'vendorCode', message: expect.stringMatching(/Unknown vendor/) });
    expect(inactive.errors[0]).toMatchObject({ field: 'vendorCode', message: expect.stringMatching(/inactive/) });
    expect(notJob.errors[0]).toMatchObject({ field: 'vendorCode', message: expect.stringMatching(/job-work/) });
    expect(withBin.errors[0]).toMatchObject({ field: 'binCode' });
    expect(elsewhere.errors[0]).toMatchObject({ field: 'vendorCode', message: expect.stringMatching(/only for the Sub Contractor/) });
    expect(dupe.errors[0].message).toMatch(/same part at vendor JW-1/);
  });

  it('matches unique Old Code and rejects ambiguous Old Code', () => {
    const oldItems = [
      item('10', 'ANARM00001', null, 'BRG'),
      item('11', 'ANARM00002', null, 'BRG'),
      item('12', 'ANARM00003', null, 'BRG'),
    ];
    const c = ctx({
      itemsByOldCode: new Map([
        ['BS5018030010', [oldItems[0]]],
        ['DUP-OLD', [oldItems[1], oldItems[2]]],
      ]),
    });
    const [byOld, ambiguous, missing] = evaluateRows(
      [
        row({ partNumber: 'BS5018030010', categoryCode: 'BRG' }),
        row({ partNumber: 'DUP-OLD', categoryCode: 'BRG', batchNo: 'B2' }),
        row({ partNumber: 'UNKNOWN-OLD', categoryCode: 'BRG', batchNo: 'B3' }),
      ],
      c,
    );
    expect(byOld).toMatchObject({ matchStatus: 'MATCHED', matchedItemId: '10' });
    expect(ambiguous.errors[0].message).toMatch(/Ambiguous Old Code/);
    expect(missing.errors[0].message).toBe(PART_NOT_FOUND_MESSAGE);
  });
});
