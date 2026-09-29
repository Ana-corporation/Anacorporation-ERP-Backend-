/**
 * Supplier codes follow Ana master list prefixes only:
 *   RM001, CS001, SP001, ES001  (no short-name suffix like "CSKMETA")
 *
 * supplierType is persisted on Vendor and also drives code prefix on create.
 */

export const SUPPLIER_TYPES = [
  'RM Supplier',
  'Component Supplier',
  'Service Provider',
  'Electrical Suppliers',
] as const;

export type SupplierType = (typeof SUPPLIER_TYPES)[number];

export const SUPPLIER_TYPE_PREFIX: Record<SupplierType, string> = {
  'RM Supplier': 'RM',
  'Component Supplier': 'CS',
  'Service Provider': 'SP',
  'Electrical Suppliers': 'ES',
};

/**
 * Placeholder prefix for vendors created by "Send Vendor Registration" before the
 * vendor picks a supplier type. Replaced by the real prefix on form submit.
 */
export const DRAFT_VENDOR_CODE_PREFIX = 'DR';

export function isSupplierType(value: unknown): value is SupplierType {
  return typeof value === 'string' && (SUPPLIER_TYPES as readonly string[]).includes(value);
}

export function isDraftVendorCode(vendorCode: string | null | undefined): boolean {
  return parseVendorSequence(vendorCode ?? '', DRAFT_VENDOR_CODE_PREFIX) !== null;
}

const CODE_RE = /^(RM|CS|SP|ES|DR)(\d{3})$/;

export function parseVendorSequence(vendorCode: string, prefix: string): number | null {
  const m = vendorCode.trim().toUpperCase().match(CODE_RE);
  if (!m || m[1] !== prefix) return null;
  return Number(m[2]);
}

export function formatVendorCode(prefix: string, sequence: number): string {
  if (sequence < 1 || sequence > 999) {
    throw new Error(`Vendor sequence out of range for prefix ${prefix}: ${sequence}`);
  }
  return `${prefix}${String(sequence).padStart(3, '0')}`;
}
