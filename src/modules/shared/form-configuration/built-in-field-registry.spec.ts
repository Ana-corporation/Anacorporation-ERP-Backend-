import {
  getBuiltInField,
  getBuiltInFields,
  getBuiltInApiKey,
  resolveBuiltInVisibility,
  VENDOR_BUILT_IN_FIELDS,
  VENDOR_BUILT_IN_FIELD_API_MAP,
  ITEM_BUILT_IN_FIELDS,
  ITEM_BUILT_IN_FIELD_API_MAP,
  isSupportedFormConfigurationEntity,
} from './built-in-field-registry';

describe('built-in-field-registry', () => {
  it('marks vendorName as non-configurable', () => {
    const field = getBuiltInField('vendor', 'vendorName');
    expect(field?.configurable).toBe(false);
    expect(field?.defaultVisible).toBe(true);
  });

  it('uses defaultVisible when no override exists', () => {
    const website = getBuiltInField('vendor', 'website')!;
    expect(resolveBuiltInVisibility(website, new Map())).toBe(true);
  });

  it('applies company override for configurable fields', () => {
    const website = getBuiltInField('vendor', 'website')!;
    expect(resolveBuiltInVisibility(website, new Map([['website', false]]))).toBe(false);
  });

  it('ignores override for protected fields', () => {
    const vendorName = getBuiltInField('vendor', 'vendorName')!;
    expect(resolveBuiltInVisibility(vendorName, new Map([['vendorName', false]]))).toBe(true);
  });

  it('includes all spec vendor fields', () => {
    const keys = VENDOR_BUILT_IN_FIELDS.map((f) => f.fieldKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        'vendorName',
        'supplierCode',
        'vendorCategory',
        'email',
        'phone',
        'website',
        'paymentTerms',
        'creditLimit',
        'address',
        'bankName',
        'remarks',
      ]),
    );
    expect(keys.length).toBeGreaterThanOrEqual(40);
  });

  it('maps fieldKey to apiKey contract', () => {
    expect(VENDOR_BUILT_IN_FIELD_API_MAP.vendorName).toBe('name');
    expect(VENDOR_BUILT_IN_FIELD_API_MAP.website).toBe('metadata.website');
  });

  it('supports vendor and item entity types', () => {
    expect(isSupportedFormConfigurationEntity('vendor')).toBe(true);
    expect(isSupportedFormConfigurationEntity('item')).toBe(true);
    expect(isSupportedFormConfigurationEntity('customer')).toBe(false);
  });

  it('locks itemCode and description', () => {
    expect(getBuiltInField('item', 'itemCode')?.configurable).toBe(false);
    expect(getBuiltInField('item', 'description')?.configurable).toBe(false);
    expect(getBuiltInField('item', 'itemType')?.configurable).toBe(false);
    expect(getBuiltInField('item', 'status')?.configurable).toBe(false);
  });

  it('uses unique store-prefixed keys for bag collisions', () => {
    const purchaseWeight = getBuiltInField('item', 'purchase.weight')!;
    const salesWeight = getBuiltInField('item', 'sales.weight')!;
    const inventoryWeight = getBuiltInField('item', 'inventory.weight')!;

    expect(purchaseWeight.storage).toEqual({ kind: 'bag', bag: 'purchase', bagKey: 'weight' });
    expect(salesWeight.storage).toEqual({ kind: 'bag', bag: 'sales', bagKey: 'weight' });
    expect(inventoryWeight.storage).toEqual({ kind: 'bag', bag: 'inventory', bagKey: 'weight' });

    expect(getBuiltInApiKey(purchaseWeight)).toBe('purchase.weight');
    expect(ITEM_BUILT_IN_FIELD_API_MAP['purchase.weight']).toBe('purchase.weight');
    expect(ITEM_BUILT_IN_FIELD_API_MAP['sales.taxPercent']).toBe('sales.taxPercent');
  });

  it('has unique fieldKeys across the item registry', () => {
    const keys = ITEM_BUILT_IN_FIELDS.map((f) => f.fieldKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(70);
  });

  it('returns sorted item fields for getBuiltInFields', () => {
    const fields = getBuiltInFields('item');
    expect(fields[0].fieldKey).toBe('itemCode');
    expect(fields.some((f) => f.fieldKey === 'barcode')).toBe(true);
    expect(fields.some((f) => f.fieldKey === 'planning.leadTimeDays')).toBe(true);
  });
});
