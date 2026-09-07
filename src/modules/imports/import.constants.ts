export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_SESSION_TTL_HOURS = 24;
export const IMPORT_CONFIRM_CHUNK_SIZE = 100;

export const IMPORT_ALLOWED_EXTENSIONS = new Set(['xlsx', 'csv']);

export const IMPORT_ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
]);

export const IMPORT_ERROR_CODES = {
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  IMPORT_TOO_MANY_ROWS: 'IMPORT_TOO_MANY_ROWS',
  INVALID_TEMPLATE: 'INVALID_TEMPLATE',
  MISSING_REQUIRED_COLUMN: 'MISSING_REQUIRED_COLUMN',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  IMPORT_NOT_FOUND: 'IMPORT_NOT_FOUND',
  IMPORT_EXPIRED: 'IMPORT_EXPIRED',
  IMPORT_NOT_AUTHORIZED: 'IMPORT_NOT_AUTHORIZED',
  IMPORT_ALREADY_COMPLETED: 'IMPORT_ALREADY_COMPLETED',
  IMPORT_INVALID_STATUS: 'IMPORT_INVALID_STATUS',
  DUPLICATE_VENDOR_CODE: 'DUPLICATE_VENDOR_CODE',
  DUPLICATE_VENDOR_NAME: 'DUPLICATE_VENDOR_NAME',
  DUPLICATE_ITEM_CODE: 'DUPLICATE_ITEM_CODE',
  INVALID_SUPPLIER_TYPE: 'INVALID_SUPPLIER_TYPE',
  INVALID_CATEGORY: 'INVALID_CATEGORY',
  INVALID_UNIT: 'INVALID_UNIT',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  LOCATION_NOT_FOUND: 'LOCATION_NOT_FOUND',
  EMPTY_FILE: 'EMPTY_FILE',
} as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[keyof typeof IMPORT_ERROR_CODES];

export interface ImportRowError {
  field: string;
  code: ImportErrorCode | string;
  message: string;
}

export interface ImportValidatedRow {
  rowNumber: number;
  status: 'VALID' | 'INVALID';
  data: Record<string, unknown>;
  errors: ImportRowError[];
}

export interface ImportSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows?: number;
  skippedRows?: number;
  failedRows?: number;
}
