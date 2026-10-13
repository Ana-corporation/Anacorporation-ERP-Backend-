import { MaterialIssueSchema, OpeningStockSchema, StockAdjustmentSchema } from './inventory-document.dto';

const line = (extra: Record<string, unknown>) => ({ itemId: '10', inventoryLocationId: '5', ...extra });
const errorPaths = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  result.success ? [] : [...new Set(result.error!.issues.map((i) => i.path.join('.')))];

describe('inventory document DTOs', () => {
  it('opening stock: quantity must be > 0 with at most 6 decimals', () => {
    const parse = (quantity: unknown) =>
      OpeningStockSchema.safeParse({ documentDate: '2026-10-01', lines: [line({ quantity })] });

    expect(parse('12.5').success).toBe(true);
    expect(parse(3).data?.lines[0].quantity).toBe('3');
    expect(errorPaths(parse('0'))).toEqual(['lines.0.quantity']);
    expect(errorPaths(parse('-1'))).toEqual(['lines.0.quantity']);
    expect(errorPaths(parse('1.1234567'))).toEqual(['lines.0.quantity']);
    expect(errorPaths(parse('abc'))).toEqual(['lines.0.quantity']);
  });

  it('requires a location (inventoryLocationId or warehouseId), a date and at least one line', () => {
    expect(
      errorPaths(OpeningStockSchema.safeParse({ documentDate: '2026-10-01', lines: [{ itemId: '1', quantity: '1' }] })),
    ).toEqual(['lines.0.inventoryLocationId']);
    expect(
      OpeningStockSchema.safeParse({ documentDate: '2026-10-01', lines: [{ itemId: '1', warehouseId: '2', quantity: '1' }] })
        .success,
    ).toBe(true);
    expect(errorPaths(OpeningStockSchema.safeParse({ documentDate: '01/10/2026', lines: [line({ quantity: '1' })] }))).toEqual([
      'documentDate',
    ]);
    expect(errorPaths(OpeningStockSchema.safeParse({ documentDate: '2026-10-01', lines: [] }))).toEqual(['lines']);
  });

  it('material issue requires requestedBy', () => {
    const base = { documentDate: '2026-10-01', lines: [line({ quantity: '1' })] };
    expect(errorPaths(MaterialIssueSchema.safeParse(base))).toEqual(['requestedBy']);
    expect(errorPaths(MaterialIssueSchema.safeParse({ ...base, requestedBy: '  ' }))).toEqual(['requestedBy']);
    expect(MaterialIssueSchema.safeParse({ ...base, requestedBy: 'Line 1', departmentId: '' }).success).toBe(true);
  });

  it('stock adjustment requires reason and allows physical quantity 0', () => {
    const base = { documentDate: '2026-10-01', lines: [line({ physicalQuantity: '0' })] };
    expect(errorPaths(StockAdjustmentSchema.safeParse(base))).toEqual(['reason']);
    expect(StockAdjustmentSchema.safeParse({ ...base, reason: 'Count' }).success).toBe(true);
    expect(
      errorPaths(StockAdjustmentSchema.safeParse({ ...base, reason: 'Count', lines: [line({ physicalQuantity: '-2' })] })),
    ).toEqual(['lines.0.physicalQuantity']);
  });
});
