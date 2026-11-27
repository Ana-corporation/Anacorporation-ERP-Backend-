import { displayItemMasterUom, itemInventoryUom } from './inventory-line-resolver.service';

describe('displayItemMasterUom (Item Master → document GET)', () => {
  it('prefers inventoryUom relation over line stamp', () => {
    expect(
      displayItemMasterUom({ inventoryUom: { code: 'MTR' }, inventoryJson: { uomName: 'NOS' } }, 'NOS'),
    ).toBe('MTR');
  });

  it('uses inventoryJson when relation missing', () => {
    expect(displayItemMasterUom({ inventoryJson: { uomName: 'KG' } }, 'NOS')).toBe('KG');
  });

  it('falls back to line stamp only when master has no UoM', () => {
    expect(displayItemMasterUom({}, 'NOS')).toBe('NOS');
    expect(displayItemMasterUom({ inventoryJson: null }, null)).toBeNull();
  });

  it('itemInventoryUom reads uomName bag', () => {
    expect(itemInventoryUom({ uomName: 'MTR' })).toBe('MTR');
    expect(itemInventoryUom(null)).toBeNull();
  });
});
