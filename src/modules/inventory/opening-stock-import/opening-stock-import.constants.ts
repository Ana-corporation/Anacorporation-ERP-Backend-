/**
 * Template columns, in order: business columns first, then reference columns.
 * Total Price is never imported (Qty × Unit Price is calculated by the backend).
 */
export const OPENING_IMPORT_COLUMNS = [
  'Category Code',
  'Part Number',
  'Part Name',
  'Location Code',
  'Bin',
  'Vendor Code',
  'Qty',
  'Unit Price',
  'Inventory UOM',
  'Batch / Heat / Lot No.',
  'Serial No.',
  'Revision',
  'Remarks',
  'Store Category',
  'Part Code',
  'Material Grade',
  'Size',
  'Status',
  'Machine Model',
  'Machine No',
  'Category',
] as const;

export const OPENING_IMPORT_SAMPLE_ROW = [
  'BRG',
  '',
  'Bearing 6204 ZZ',
  'BOS-001',
  '',
  '',
  '25',
  '180.50',
  'NOS',
  'HT-2291',
  '',
  'R0',
  'Rack 3, physical count 01-Nov',
  'Bought-Out Store',
  'BRG-6204',
  'EN31',
  '20x47x14',
  'Active',
  'VMC-850',
  'M-12',
  'Bearings',
];

/** Instructions sheet of the template: column | required | meaning. */
export const OPENING_IMPORT_INSTRUCTIONS: Array<[string, string, string]> = [
  ['Category Code', 'Recommended', 'Item category code, e.g. RM, BRG, FST. When filled it must match the category of the part in Item Master.'],
  ['Part Number', 'Yes', 'ERP Item Code or unique Old Code from Item Master. Unknown → Error (never creates items). Ambiguous Old Code → Error.'],
  ['Part Name', 'No', 'Reference only; the Item Master name is used.'],
  ['Location Code', 'Yes', 'Inventory Location (store) code only, e.g. RMS-001. Do not put the bin here. For material at a job-work vendor use the Sub Contractor store code (its code prefix, e.g. SCS).'],
  ['Bin', 'If the location uses bins', 'Storage bin code inside that location, e.g. A-01. Never for the Sub Contractor store.'],
  ['Vendor Code', 'Only for the Sub Contractor store', 'Active job-work Vendor Master code. Required for Sub Contractor Store; must be empty for every other store.'],
  ['Qty', 'Yes', 'Counted opening quantity, greater than 0 (up to 6 decimals).'],
  ['Unit Price', 'Recommended', 'Value per unit. 0 or blank: confirm zero valuation per row on the review screen (or confirm all on Approve).'],
  ['Inventory UOM', 'No', 'Reference only; the Item Master unit is used (an unknown unit is reported as an error).'],
  ['Batch / Heat / Lot No.', 'No', 'Batch, heat or lot number (reference).'],
  ['Serial No.', 'No', 'Serial number (reference).'],
  ['Revision', 'No', 'Drawing revision applicable on the opening date.'],
  ['Remarks', 'No', 'Line remarks.'],
  ['Store Category', 'No', 'Store category name (e.g. Bought-Out Store). Checked against the category when filled.'],
  ['Part Code, Material Grade, Size, Machine Model, Machine No, Category, Status', 'No', 'Reference only; kept on the opening stock line where applicable.'],
];

/** Canonical row keys → accepted header spellings. */
export const OPENING_IMPORT_ALIASES: Record<string, string[]> = {
  store: ['store category', 'store', 'store name'],
  categoryCode: ['category code', 'cat code', 'category cd'],
  partNumber: ['part number', 'part no', 'part no.', 'item code'],
  partName: ['part name', 'item name', 'description'],
  partCode: ['part code', 'pant code'],
  materialGrade: ['material grade', 'grade'],
  size: ['size'],
  uom: ['inventory uom', 'uom', 'unit'],
  status: ['status'],
  locationCode: ['location code', 'loction code', 'location', 'store location', 'store code'],
  binCode: ['bin', 'bin code', 'storage bin'],
  vendorCode: ['vendor code', 'vendor', 'supplier code'],
  quantity: ['qty', 'quantity'],
  unitPrice: ['unit price', 'price', 'rate'],
  batchNo: ['batch / heat / lot no.', 'batch / heat / lot no', 'batch no', 'batch', 'heat no', 'lot no', 'heat / lot no'],
  serialNo: ['serial no.', 'serial no', 'serial number', 'serial'],
  revision: ['revision', 'revision status', 'rev'],
  remarks: ['remarks', 'line remarks'],
  machineModel: ['machine model'],
  machineNo: ['machine no', 'machine no.', 'machine number'],
  category: ['category'],
};

/** Columns that must exist in the file. */
export const OPENING_IMPORT_REQUIRED_COLUMNS = ['partNumber', 'locationCode', 'quantity'] as const;

export const OPENING_IMPORT_ERROR_CODES = {
  NOT_FOUND: 'OPENING_IMPORT_NOT_FOUND',
  MISSING_COLUMNS: 'OPENING_IMPORT_MISSING_COLUMNS',
  LOCKED: 'OPENING_IMPORT_APPROVED',
  NOT_READY: 'OPENING_IMPORT_NOT_READY',
  ROW_NOT_FOUND: 'OPENING_IMPORT_ROW_NOT_FOUND',
  ZERO_PRICE: 'OPENING_STOCK_ZERO_PRICE',
} as const;

/** Name similarity (0-1) from which an existing item is shown as a possible duplicate. */
export const OPENING_IMPORT_SIMILAR_MIN_SCORE = 0.6;
export const OPENING_IMPORT_SIMILAR_MAX = 3;

/** Rows inserted per statement. */
export const OPENING_IMPORT_CHUNK = 500;

/** Rows re-written per bulk UPDATE after validation. */
export const OPENING_IMPORT_UPDATE_CHUNK = 1000;

/** Approve creates items + posts up to 5,000 lines in one transaction. */
export const OPENING_IMPORT_APPROVE_TIMEOUT_MS = 10 * 60_000;
