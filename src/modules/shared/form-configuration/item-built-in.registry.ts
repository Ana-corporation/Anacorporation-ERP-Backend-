import {
  BuiltInFieldDefinition,
  BuiltInFieldStorage,
  getBuiltInApiKey,
} from './built-in-field-registry.types';

type FieldSeed = Omit<BuiltInFieldDefinition, 'entityType'>;

function itemField(seed: FieldSeed): BuiltInFieldDefinition {
  return { ...seed, entityType: 'item' };
}

function core(
  fieldKey: string,
  label: string,
  sectionKey: string,
  apiKey: string,
  fieldType: string,
  sortOrder: number,
  opts: Partial<Pick<BuiltInFieldDefinition, 'defaultVisible' | 'required' | 'configurable'>> = {},
): BuiltInFieldDefinition {
  return itemField({
    fieldKey,
    label,
    sectionKey,
    fieldType,
    defaultVisible: opts.defaultVisible ?? true,
    required: opts.required ?? false,
    configurable: opts.configurable ?? true,
    sortOrder,
    storage: { kind: 'core', apiKey },
  });
}

/** Bag field: fieldKey = `{bag}.{bagKey}` (unique across purchase/sales/inventory/…). */
function bag(
  bagName: 'purchase' | 'sales' | 'inventory' | 'planning' | 'production',
  bagKey: string,
  label: string,
  sectionKey: string,
  fieldType: string,
  sortOrder: number,
  opts: Partial<Pick<BuiltInFieldDefinition, 'defaultVisible' | 'required' | 'configurable'>> = {},
): BuiltInFieldDefinition {
  const fieldKey = `${bagName}.${bagKey}`;
  const storage: BuiltInFieldStorage = { kind: 'bag', bag: bagName, bagKey };
  return itemField({
    fieldKey,
    label,
    sectionKey,
    fieldType,
    defaultVisible: opts.defaultVisible ?? true,
    required: opts.required ?? false,
    configurable: opts.configurable ?? true,
    sortOrder,
    storage,
  });
}

/**
 * Developer-controlled registry of standard Item Master form fields.
 * Bag collisions use store-prefixed fieldKeys (purchase.weight vs sales.weight).
 */
export const ITEM_BUILT_IN_FIELDS: BuiltInFieldDefinition[] = [
  // —— Header (protected identity) ——
  core('itemCode', 'Item code', 'header', 'itemCode', 'text', 10, {
    required: true,
    configurable: false,
  }),
  core('itemType', 'Item type', 'header', 'itemType', 'select', 20, {
    required: true,
    configurable: false,
  }),
  core('description', 'Description', 'header', 'description', 'text', 30, {
    required: true,
    configurable: false,
  }),
  core('isInventoryItem', 'Inventory item', 'header', 'isInventoryItem', 'switch', 40, {
    configurable: false,
  }),
  core('isSalesItem', 'Sales item', 'header', 'isSalesItem', 'switch', 50, {
    configurable: false,
  }),
  core('isPurchaseItem', 'Purchase item', 'header', 'isPurchaseItem', 'switch', 60, {
    configurable: false,
  }),

  // —— General ——
  core('oldCode', 'Old code', 'general', 'oldCode', 'text', 110),
  core('barcode', 'Bar code', 'general', 'barcode', 'text', 120),
  core('itemGroup', 'Item group', 'general', 'itemGroup', 'text', 130),
  core('uomGroup', 'UoM group', 'general', 'uomGroup', 'text', 140),
  core('manufacturer', 'Manufacturer', 'general', 'manufacturer', 'text', 150),
  core('additionalIdentifier', 'Additional identifier', 'general', 'additionalIdentifier', 'text', 160),
  core('shippingType', 'Shipping type', 'general', 'shippingType', 'select', 170),
  core('manageBy', 'Manage by', 'general', 'manageBy', 'select', 180),
  core('priceList', 'Price list', 'general', 'priceList', 'text', 190),
  core('unitPrice', 'Unit price', 'general', 'unitPrice', 'number', 200),
  core('currencyCode', 'Currency', 'general', 'currencyCode', 'text', 210),
  core('doNotApplyDiscountGroups', 'Do not apply discount groups', 'general', 'doNotApplyDiscountGroups', 'switch', 220),
  core('status', 'Status', 'general', 'status', 'select', 230, {
    configurable: false,
  }),
  core('activeFrom', 'Active from', 'general', 'activeFrom', 'date', 240),
  core('activeTo', 'Active to', 'general', 'activeTo', 'date', 250),

  // —— Classification ——
  core('division', 'Division', 'classification', 'division', 'text', 310),
  core('coreActivity', 'Core activity', 'classification', 'coreActivity', 'text', 320),
  core('majorGroup', 'Major group', 'classification', 'majorGroup', 'text', 330),
  core('brandName', 'Brand name', 'classification', 'brandName', 'text', 340),
  core('contractItemsFor', 'Contract items for', 'classification', 'contractItemsFor', 'text', 350),
  core('netWeightKg', 'Net weight (kg)', 'classification', 'netWeightKg', 'number', 360),
  core('grossWeightKg', 'Gross weight (kg)', 'classification', 'grossWeightKg', 'number', 370),
  core('effectiveDate', 'Effective date', 'classification', 'effectiveDate', 'date', 380),
  core('customerStockNo', 'Customer stock no.', 'classification', 'customerStockNo', 'text', 390),
  core('stockToBe', 'Stock to be', 'classification', 'stockToBe', 'text', 400),
  core('stockDioDays', 'Stock DIO days', 'classification', 'stockDioDays', 'number', 410),

  // —— Purchasing (columns + purchase.* bag) ——
  core('preferredVendorId', 'Preferred vendor', 'purchasing', 'preferredVendorId', 'text', 510),
  core('valuationMethod', 'Valuation method', 'purchasing', 'valuationMethod', 'select', 520),
  core('itemCost', 'Item cost', 'purchasing', 'itemCost', 'number', 530),
  bag('purchase', 'mfrCatalogNo', 'Mfr catalog no.', 'purchasing', 'text', 540),
  bag('purchase', 'purchasingUomName', 'Purchasing UoM', 'purchasing', 'text', 550),
  bag('purchase', 'itemsPerPurchaseUnit', 'Items per purchase unit', 'purchasing', 'number', 560),
  bag('purchase', 'packagingUomName', 'Packaging UoM', 'purchasing', 'text', 570),
  bag('purchase', 'quantityPerPackage', 'Quantity per package', 'purchasing', 'number', 580),
  bag('purchase', 'weight', 'Weight', 'purchasing', 'number', 590),
  bag('purchase', 'length', 'Length', 'purchasing', 'number', 600),
  bag('purchase', 'width', 'Width', 'purchasing', 'number', 610),
  bag('purchase', 'height', 'Height', 'purchasing', 'number', 620),
  bag('purchase', 'volume', 'Volume', 'purchasing', 'number', 630),
  bag('purchase', 'volumeUnit', 'Volume unit', 'purchasing', 'text', 640),
  bag('purchase', 'factor1', 'Factor 1', 'purchasing', 'number', 650),
  bag('purchase', 'factor2', 'Factor 2', 'purchasing', 'number', 660),
  bag('purchase', 'factor3', 'Factor 3', 'purchasing', 'number', 670),
  bag('purchase', 'factor4', 'Factor 4', 'purchasing', 'number', 680),
  bag('purchase', 'customsGroup', 'Customs group', 'purchasing', 'text', 690),
  bag('purchase', 'customsPercent', 'Customs %', 'purchasing', 'number', 700),
  bag('purchase', 'taxGroup', 'Tax group', 'purchasing', 'select', 710),
  bag('purchase', 'taxPercent', 'Tax %', 'purchasing', 'number', 720),

  // —— Sales (sales.* bag) ——
  bag('sales', 'salesUomName', 'Sales UoM', 'sales', 'text', 810),
  bag('sales', 'itemsPerSalesUnit', 'Items per sales unit', 'sales', 'number', 820),
  bag('sales', 'packagingUomName', 'Packaging UoM', 'sales', 'text', 830),
  bag('sales', 'quantityPerPackage', 'Quantity per package', 'sales', 'number', 840),
  bag('sales', 'taxGroup', 'Tax group', 'sales', 'select', 850),
  bag('sales', 'taxPercent', 'Tax %', 'sales', 'number', 860),
  bag('sales', 'length', 'Length', 'sales', 'number', 870),
  bag('sales', 'width', 'Width', 'sales', 'number', 880),
  bag('sales', 'height', 'Height', 'sales', 'number', 890),
  bag('sales', 'volume', 'Volume', 'sales', 'number', 900),
  bag('sales', 'volumeUnit', 'Volume unit', 'sales', 'text', 910),
  bag('sales', 'weight', 'Weight', 'sales', 'number', 920),
  bag('sales', 'factor1', 'Factor 1', 'sales', 'number', 930),
  bag('sales', 'factor2', 'Factor 2', 'sales', 'number', 940),
  bag('sales', 'factor3', 'Factor 3', 'sales', 'number', 950),
  bag('sales', 'factor4', 'Factor 4', 'sales', 'number', 960),

  // —— Inventory ——
  core('manageStockByWarehouse', 'Manage stock by warehouse', 'inventory', 'manageStockByWarehouse', 'switch', 1010),
  bag('inventory', 'setGlAccountsBy', 'Set G/L accounts by', 'inventory', 'select', 1020),
  bag('inventory', 'uomName', 'Inventory UoM', 'inventory', 'text', 1030),
  bag('inventory', 'weight', 'Weight', 'inventory', 'number', 1040),
  bag('inventory', 'requiredQty', 'Required qty', 'inventory', 'number', 1050),
  bag('inventory', 'minimumQty', 'Minimum qty', 'inventory', 'number', 1060),
  bag('inventory', 'maximumQty', 'Maximum qty', 'inventory', 'number', 1070),

  // —— Planning ——
  bag('planning', 'planningMethod', 'Planning method', 'planning', 'select', 1110),
  bag('planning', 'procurementMethod', 'Procurement method', 'planning', 'select', 1120),
  bag('planning', 'orderInterval', 'Order interval', 'planning', 'text', 1130),
  bag('planning', 'orderMultiple', 'Order multiple', 'planning', 'number', 1140),
  bag('planning', 'minimumOrderQty', 'Minimum order qty', 'planning', 'number', 1150),
  bag('planning', 'leadTimeDays', 'Lead time (days)', 'planning', 'number', 1160),
  bag('planning', 'toleranceDays', 'Tolerance (days)', 'planning', 'number', 1170),

  // —— Production ——
  bag('production', 'phantomItem', 'Phantom item', 'production', 'switch', 1210),
  bag('production', 'issueMethod', 'Issue method', 'production', 'select', 1220),
  bag('production', 'bomType', 'BOM type', 'production', 'select', 1230),
  bag('production', 'productionStdCost', 'Production std cost', 'production', 'number', 1240),
  bag('production', 'includeInStdCostRollup', 'Include in std cost rollup', 'production', 'switch', 1250),

  // —— Remarks ——
  core('remarks', 'Remarks', 'remarks', 'remarks', 'multiline', 1310),
];

/** fieldKey → API path map (shared contract for FE). */
export const ITEM_BUILT_IN_FIELD_API_MAP: Record<string, string> = Object.fromEntries(
  ITEM_BUILT_IN_FIELDS.map((f) => [f.fieldKey, getBuiltInApiKey(f)]),
);
