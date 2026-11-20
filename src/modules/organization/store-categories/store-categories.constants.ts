export const STORE_CATEGORY_ERROR_CODES = {
  NOT_FOUND: 'STORE_CATEGORY_NOT_FOUND',
  NAME_EXISTS: 'STORE_CATEGORY_NAME_EXISTS',
  PREFIX_EXISTS: 'STORE_CATEGORY_PREFIX_EXISTS',
  PREFIX_LOCKED: 'STORE_CATEGORY_PREFIX_LOCKED',
  IN_USE: 'STORE_CATEGORY_IN_USE',
  INACTIVE: 'STORE_CATEGORY_INACTIVE',
  SUBCONTRACTOR_EXISTS: 'STORE_CATEGORY_SUBCONTRACTOR_EXISTS',
  STORE_TYPE_LOCKED: 'STORE_CATEGORY_STORE_TYPE_LOCKED',
} as const;

/** NORMAL = own store; SUBCONTRACTOR = material held by job-work vendors (one location per vendor, no bins). */
export const STORE_TYPES = ['NORMAL', 'SUBCONTRACTOR'] as const;
export type StoreType = (typeof STORE_TYPES)[number];

/** Created for every new company (and every existing company without categories). */
export const DEFAULT_STORE_CATEGORY = { name: 'General Store', codePrefix: 'GEN', sortOrder: 1 } as const;
