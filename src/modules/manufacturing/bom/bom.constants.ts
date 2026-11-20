import { HttpStatus } from '@nestjs/common';
import { BusinessException, FieldError } from '@/common/exceptions/business.exception';

export const BOM_ERROR_CODES = {
  NOT_FOUND: 'BOM_NOT_FOUND',
  LINE_NOT_FOUND: 'BOM_LINE_NOT_FOUND',
  PARENT_ITEM_REQUIRED: 'PARENT_ITEM_REQUIRED',
  PARENT_NOT_MAKE_ITEM: 'PARENT_NOT_MAKE_ITEM',
  PARENT_ITEM_INACTIVE: 'PARENT_ITEM_INACTIVE',
  PARENT_HAS_RELEASED_BOM: 'PARENT_HAS_RELEASED_BOM',
  COMPONENT_REQUIRED: 'COMPONENT_REQUIRED',
  COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
  COMPONENT_INACTIVE: 'COMPONENT_INACTIVE',
  LINES_REQUIRED: 'LINES_REQUIRED',
  MAIN_LINE_NOT_FOUND: 'MAIN_LINE_NOT_FOUND',
  SUB_PARENT_MUST_BE_MAIN: 'SUB_PARENT_MUST_BE_MAIN',
  MAIN_HAS_SUB_LINES: 'MAIN_HAS_SUB_LINES',
  FIELD_NOT_ALLOWED: 'FIELD_NOT_ALLOWED',
  QTY_MUST_BE_POSITIVE: 'QTY_MUST_BE_POSITIVE',
  SCRAP_OUT_OF_RANGE: 'SCRAP_OUT_OF_RANGE',
  UOM_INVALID: 'UOM_INVALID',
  UOM_CONVERSION_MISSING: 'UOM_CONVERSION_MISSING',
  SELF_REFERENCE: 'SELF_REFERENCE',
  DUPLICATE_COMPONENT: 'DUPLICATE_COMPONENT',
  EFFECTIVE_DATE_INVALID: 'EFFECTIVE_DATE_INVALID',
  BOM_LOCKED: 'BOM_LOCKED',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  REASON_REQUIRED: 'REASON_REQUIRED',
  REVISION_REASON_REQUIRED: 'REVISION_REASON_REQUIRED',
  OPEN_REVISION_EXISTS: 'OPEN_REVISION_EXISTS',
  ROW_VERSION_CONFLICT: 'ROW_VERSION_CONFLICT',
  MACHINE_VARIANT_BOM_VIA_VARIANT: 'MACHINE_VARIANT_BOM_VIA_VARIANT',
} as const;

export type BomErrorCode = (typeof BOM_ERROR_CODES)[keyof typeof BOM_ERROR_CODES];

/** Warning codes (do not block). */
export const BOM_WARNING_CODES = {
  COMPONENT_INACTIVE: 'COMPONENT_INACTIVE',
  COMPONENT_OBSOLETE: 'COMPONENT_OBSOLETE',
  MAIN_WITHOUT_SUB_LINES: 'MAIN_WITHOUT_SUB_LINES',
} as const;

/** The route decides MAIN vs SUB and the backend assigns the key: these are never accepted. */
export const FORBIDDEN_LINE_KEYS = ['commonKey', 'lineType', 'parentLineId'] as const;

export const BOM_ACTIONS = [
  'edit',
  'addMain',
  'addSub',
  'editLine',
  'deleteLine',
  'validate',
  'requirements',
  'release',
  'cancel',
  'delete',
  'revise',
  'obsolete',
] as const;
export type BomAction = (typeof BOM_ACTIONS)[number];

/** Gap between generated line numbers so lines can later be inserted in between. */
export const LINE_NUMBER_STEP = 10;

export const HTTP_STATUS_BY_CODE: Partial<Record<BomErrorCode, HttpStatus>> = {
  BOM_NOT_FOUND: HttpStatus.NOT_FOUND,
  BOM_LINE_NOT_FOUND: HttpStatus.NOT_FOUND,
  MAIN_LINE_NOT_FOUND: HttpStatus.NOT_FOUND,
  COMPONENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  BOM_LOCKED: HttpStatus.CONFLICT,
  INVALID_STATUS_TRANSITION: HttpStatus.CONFLICT,
  PARENT_HAS_RELEASED_BOM: HttpStatus.CONFLICT,
  OPEN_REVISION_EXISTS: HttpStatus.CONFLICT,
  MAIN_HAS_SUB_LINES: HttpStatus.CONFLICT,
  ROW_VERSION_CONFLICT: HttpStatus.CONFLICT,
};

export interface BomIssue extends FieldError {
  code: string;
  lineId?: string;
}

export function bomError(code: BomErrorCode, message: string, field?: string, extra: Partial<BomIssue> = {}): BusinessException {
  return new BusinessException(
    message,
    HTTP_STATUS_BY_CODE[code] ?? HttpStatus.BAD_REQUEST,
    field ? [{ field, message, code, ...extra }] : undefined,
    code,
  );
}

/** Several validation errors at once; the first one's code is the summary code. */
export function bomValidationError(errors: BomIssue[]): BusinessException {
  const first = errors[0];
  return new BusinessException(
    errors.length === 1 ? first.message : `${errors.length} validation errors: ${first.message}`,
    HTTP_STATUS_BY_CODE[first.code as BomErrorCode] ?? HttpStatus.BAD_REQUEST,
    errors,
    first.code,
  );
}

export const bomNotFound = () => bomError(BOM_ERROR_CODES.NOT_FOUND, 'BOM not found');

export const rowVersionConflict = () =>
  bomError(BOM_ERROR_CODES.ROW_VERSION_CONFLICT, 'This BOM was changed by someone else. Reload and try again.', 'rowVersion');

export const bomLocked = (status: string) =>
  bomError(BOM_ERROR_CODES.BOM_LOCKED, `Only a DRAFT BOM can be changed (this one is ${status}). Create a revision instead.`);
