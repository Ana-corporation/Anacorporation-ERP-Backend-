export const STORE_CATEGORY_ERROR_CODES = {
  NOT_FOUND: 'STORE_CATEGORY_NOT_FOUND',
  NAME_EXISTS: 'STORE_CATEGORY_NAME_EXISTS',
  PREFIX_EXISTS: 'STORE_CATEGORY_PREFIX_EXISTS',
  PREFIX_LOCKED: 'STORE_CATEGORY_PREFIX_LOCKED',
  IN_USE: 'STORE_CATEGORY_IN_USE',
  INACTIVE: 'STORE_CATEGORY_INACTIVE',
} as const;

/** Created for every new company (and every existing company without categories). */
export const DEFAULT_STORE_CATEGORY = { name: 'General Store', codePrefix: 'GEN', sortOrder: 1 } as const;
