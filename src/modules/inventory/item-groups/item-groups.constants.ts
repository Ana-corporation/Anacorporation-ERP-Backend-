export const ITEM_GROUP_ERROR_CODES = {
  NOT_FOUND: 'ITEM_GROUP_NOT_FOUND',
  NAME_EXISTS: 'ITEM_GROUP_NAME_EXISTS',
  CODE_EXISTS: 'ITEM_GROUP_CODE_EXISTS',
  CODE_LOCKED: 'ITEM_GROUP_CODE_LOCKED',
  CODE_INVALID: 'ITEM_GROUP_CODE_INVALID',
  STORE_INVALID: 'ITEM_GROUP_STORE_INVALID',
  PARENT_INVALID: 'ITEM_GROUP_PARENT_INVALID',
  TOO_DEEP: 'ITEM_GROUP_TOO_DEEP',
  IN_USE: 'ITEM_GROUP_IN_USE',
  STAGE_TAKEN: 'ITEM_GROUP_STAGE_TAKEN',
} as const;

/** Made-part stages a category can represent. */
export const ITEM_GROUP_MATERIAL_STAGES = ['RM', 'SF', 'FF'] as const;

/** Levels below a root group (root = depth 0). */
export const ITEM_GROUP_MAX_DEPTH = 9;

/** Category code = part-number segment (BRG, PLY, ASSY). */
export const CATEGORY_CODE_PATTERN = /^[A-Z]{2,4}$/;
