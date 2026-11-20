import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '@/common/exceptions/business.exception';

export const MACHINE_ERROR_CODES = {
  NOT_FOUND: 'MACHINE_NOT_FOUND',
  CODE_EXISTS: 'MACHINE_CODE_EXISTS',
  CODE_INVALID: 'MACHINE_CODE_INVALID',
  SETTINGS_MISSING: 'MACHINE_SETTINGS_MISSING',
  IN_USE: 'MACHINE_IN_USE',
  SALES_ORDER_NO_INVALID: 'SALES_ORDER_NO_INVALID',
  VARIANT_EXISTS: 'VARIANT_EXISTS',
  BASE_BOM_NOT_RELEASED: 'BASE_BOM_NOT_RELEASED',
  VARIANT_OF_VARIANT: 'VARIANT_OF_VARIANT',
  ITEM_ALREADY_LINKED: 'ITEM_ALREADY_LINKED',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  ROW_VERSION_CONFLICT: 'ROW_VERSION_CONFLICT',
} as const;

type MachineErrorCode = (typeof MACHINE_ERROR_CODES)[keyof typeof MACHINE_ERROR_CODES];

const STATUS: Partial<Record<MachineErrorCode, HttpStatus>> = {
  MACHINE_NOT_FOUND: HttpStatus.NOT_FOUND,
  ITEM_NOT_FOUND: HttpStatus.NOT_FOUND,
  CUSTOMER_NOT_FOUND: HttpStatus.NOT_FOUND,
  MACHINE_CODE_EXISTS: HttpStatus.CONFLICT,
  MACHINE_IN_USE: HttpStatus.CONFLICT,
  VARIANT_EXISTS: HttpStatus.CONFLICT,
  BASE_BOM_NOT_RELEASED: HttpStatus.CONFLICT,
  ITEM_ALREADY_LINKED: HttpStatus.CONFLICT,
  ROW_VERSION_CONFLICT: HttpStatus.CONFLICT,
};

export function machineError(code: MachineErrorCode, message: string, field?: string): BusinessException {
  return new BusinessException(message, STATUS[code] ?? HttpStatus.BAD_REQUEST, field ? [{ field, message, code }] : undefined, code);
}

export const machineNotFound = () => machineError(MACHINE_ERROR_CODES.NOT_FOUND, 'Machine not found');

/** Base machine code: model typed by the user, e.g. BS500, ZETA700 (A-Z, 0-9, '-'). */
export const MACHINE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,39}$/;
/** Sales order number used in the customised machine suffix: SO + 5 digits. */
export const SALES_ORDER_NO_PATTERN = /^SO\d{5}$/;

export const variantCode = (baseCode: string, salesOrderNo: string) => `${baseCode}-${salesOrderNo}`;

/** Item custom fields set on a machine's item when the company defines them (and the option exists). */
export const MACHINE_ITEM_FIELD_VALUES: Record<string, string> = {
  procurementType: 'Make',
  materialType: 'Finished Good',
  materialCategory: 'Mechanical',
};
