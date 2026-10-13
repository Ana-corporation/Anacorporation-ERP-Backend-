import { CreateWarehouseSchema, UpdateWarehouseSchema } from './dto/warehouse.dto';
import { LOCATION_CODE_PREFIX, formatLocationCode } from './store-code.util';

describe('store location codes', () => {
  it('maps every store category to its prefix', () => {
    expect(LOCATION_CODE_PREFIX).toMatchObject({
      RawMaterialStore: 'RMS',
      SparesStore: 'SPR',
      FinishedGoodsStore: 'FGS',
      BoughtOutStore: 'BOS',
      ElectricalStore: 'ELS',
      GeneralStore: 'GEN',
      OilStore: 'OIL',
    });
  });

  it('formats PREFIX-NNN and keeps growing past 999', () => {
    expect(formatLocationCode('RMS', 1)).toBe('RMS-001');
    expect(formatLocationCode('SPR', 42)).toBe('SPR-042');
    expect(formatLocationCode('FGS', 1000)).toBe('FGS-1000');
  });

  it('create: rejects an unknown category and drops client-sent codes', () => {
    const base = { name: 'Raw Material Store - Main', branchId: '2' };
    expect(CreateWarehouseSchema.safeParse({ ...base, locationType: 'Kitchen' }).success).toBe(false);

    const parsed = CreateWarehouseSchema.parse({
      ...base,
      locationType: 'RawMaterialStore',
      warehouseCode: 'HACK-1',
      locationCode: 'HACK-2',
      companyId: '999',
    });
    expect(parsed).not.toHaveProperty('warehouseCode');
    expect(parsed).not.toHaveProperty('locationCode');
    expect(parsed).not.toHaveProperty('companyId');
  });

  it('update: code fields are dropped', () => {
    const parsed = UpdateWarehouseSchema.parse({ name: 'Renamed', warehouseCode: 'X', locationCode: 'Y' });
    expect(parsed).toEqual({ name: 'Renamed' });
  });
});
