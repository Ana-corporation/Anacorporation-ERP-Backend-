export const VENDOR_FORM_TTL_HOURS = 48;

/** Hours between reminder emails (backend decides which invitations are due). */
export const VENDOR_FORM_REMINDER_INTERVAL_HOURS = 24;

export const VENDOR_FORM_DEFAULT_MAX_SEND_COUNT = 3;

export const VENDOR_FORM_MAX_SEND_COUNT_LIMIT = 10;

/** Built-in fields vendors must not modify via the public form. */
export const VENDOR_FORM_INTERNAL_ONLY_FIELD_KEYS = new Set([
  'supplierCode',
  'vendorCode',
  'vendorCategory',
  'supplierType',
  'isActive',
  'internalNotes',
]);

export const VENDOR_FORM_ERROR_CODES = {
  EXPIRED: 'VENDOR_FORM_EXPIRED',
  INVALID: 'VENDOR_FORM_INVALID',
  SUBMITTED: 'VENDOR_FORM_ALREADY_SUBMITTED',
  CANCELLED: 'VENDOR_FORM_CANCELLED',
  FIELD_NOT_ALLOWED: 'VENDOR_FORM_FIELD_NOT_ALLOWED',
  INTERNAL_FIELD: 'VENDOR_FORM_INTERNAL_FIELD',
} as const;

export type VendorFieldFilledBy = 'INTERNAL' | 'VENDOR';

export type VendorFormFieldSnapshot = {
  value: unknown;
  filledBy: VendorFieldFilledBy | null;
};

export type VendorFormFieldSnapshotMap = Record<string, VendorFormFieldSnapshot>;
