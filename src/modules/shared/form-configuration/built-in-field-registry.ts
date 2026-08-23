import { BuiltInFieldDefinition, getBuiltInApiKey } from './built-in-field-registry.types';
import { ITEM_BUILT_IN_FIELDS, ITEM_BUILT_IN_FIELD_API_MAP } from './item-built-in.registry';
import { CustomFieldEntityType } from '../custom-fields/custom-fields.constants';

export type { BuiltInFieldDefinition, BuiltInFieldStorage } from './built-in-field-registry.types';
export { getBuiltInApiKey } from './built-in-field-registry.types';
export { ITEM_BUILT_IN_FIELDS, ITEM_BUILT_IN_FIELD_API_MAP } from './item-built-in.registry';

type FieldSeed = Omit<BuiltInFieldDefinition, 'entityType'>;

function vendorField(seed: FieldSeed): BuiltInFieldDefinition {
  return { ...seed, entityType: 'vendor' };
}

function meta(
  fieldKey: string,
  label: string,
  sectionKey: string,
  metadataKey: string,
  fieldType: string,
  sortOrder: number,
  opts: Partial<Pick<BuiltInFieldDefinition, 'defaultVisible' | 'required' | 'configurable'>> = {},
): BuiltInFieldDefinition {
  return vendorField({
    fieldKey,
    label,
    sectionKey,
    fieldType,
    defaultVisible: opts.defaultVisible ?? true,
    required: opts.required ?? false,
    configurable: opts.configurable ?? true,
    sortOrder,
    storage: { kind: 'metadata', metadataKey },
  });
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
  return vendorField({
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

/**
 * Developer-controlled registry of standard Vendor form fields.
 * Company admins may only toggle visibility on configurable fields.
 */
export const VENDOR_BUILT_IN_FIELDS: BuiltInFieldDefinition[] = [
  // —— General (protected identity fields) ——
  core('vendorName', 'Vendor Name', 'general', 'name', 'text', 10, {
    required: true,
    configurable: false,
  }),
  core('supplierCode', 'Supplier Code', 'general', 'vendorCode', 'text', 20, {
    required: true,
    configurable: false,
  }),
  core('vendorCategory', 'Vendor Category', 'general', 'supplierType', 'select', 30, {
    required: true,
    configurable: false,
  }),
  meta('foreignName', 'Foreign Name', 'general', 'foreignName', 'text', 40),
  meta('aliasName', 'Alias Name', 'general', 'aliasName', 'text', 50),
  meta('group', 'Group', 'general', 'group', 'text', 60),
  meta('currency', 'Currency', 'general', 'currency', 'text', 70),
  meta('bpType', 'BP Type', 'general', 'bpType', 'select', 80),
  meta('industry', 'Industry', 'general', 'industry', 'text', 90),
  core('isActive', 'Active', 'general', 'isActive', 'checkbox', 100),

  // —— Contact ——
  core('email', 'Email', 'contact', 'email', 'email', 110),
  core('phone', 'Phone', 'contact', 'phone', 'phone', 120),
  meta('tel2', 'Telephone 2', 'contact', 'tel2', 'phone', 130),
  meta('mobile', 'Mobile', 'contact', 'mobile', 'phone', 140),
  meta('fax', 'Fax', 'contact', 'fax', 'text', 150),
  meta('website', 'Website', 'contact', 'website', 'text', 160),
  meta('contactPerson', 'Contact Person', 'contact', 'contactPerson', 'text', 170),
  meta('shippingType', 'Shipping Type', 'contact', 'shippingType', 'select', 180),

  // —— Address ——
  core('address', 'Address', 'address', 'address', 'textarea', 210),
  core('city', 'City', 'address', 'city', 'text', 220),
  core('country', 'Country', 'address', 'country', 'text', 230),
  core('taxId', 'Tax ID / GST', 'address', 'taxId', 'text', 240),

  // —— Payment ——
  meta('paymentTerms', 'Payment Terms', 'payment', 'paymentTerms', 'select', 310),
  meta('paymentMethod', 'Payment Method', 'payment', 'paymentMethod', 'select', 320),
  meta('creditLimit', 'Credit Limit', 'payment', 'creditLimit', 'number', 330),
  meta('discountPercent', 'Discount %', 'payment', 'discountPercent', 'number', 340),
  meta('priceList', 'Price List', 'payment', 'priceList', 'text', 350),
  meta('paymentBlock', 'Payment Block', 'payment', 'paymentBlock', 'checkbox', 360),

  // —— Payment Run / Tax ——
  meta('taxGroup', 'Tax Group', 'paymentRun', 'taxGroup', 'select', 410),
  meta('withholdingTax', 'Withholding Tax', 'paymentRun', 'withholdingTax', 'text', 420),
  meta('singlePayment', 'Single Payment', 'paymentRun', 'singlePayment', 'checkbox', 430),
  meta('affiliate', 'Affiliate', 'paymentRun', 'affiliate', 'text', 440),

  // —— Bank / Accounting ——
  meta('bankName', 'Bank Name', 'accounting', 'bankName', 'text', 510),
  meta('bankAccount', 'Bank Account', 'accounting', 'bankAccount', 'text', 520),
  meta('bankBranch', 'Bank Branch', 'accounting', 'bankBranch', 'text', 530),
  meta('iban', 'IBAN', 'accounting', 'iban', 'text', 540),
  meta('swift', 'SWIFT', 'accounting', 'swift', 'text', 550),
  meta('houseBank', 'House Bank', 'accounting', 'houseBank', 'text', 560),
  meta('glAccount', 'G/L Account', 'accounting', 'glAccount', 'text', 570),
  meta('reconciliationAccount', 'Reconciliation Account', 'accounting', 'reconciliationAccount', 'text', 580),

  // —— Remarks ——
  meta('remarks', 'Remarks', 'remarks', 'remarks', 'textarea', 610),
  meta('notes', 'Notes', 'remarks', 'notes', 'textarea', 620),
  meta('internalNotes', 'Internal Notes', 'remarks', 'internalNotes', 'textarea', 630),
];

/** fieldKey → API path map (shared contract for FE). */
export const VENDOR_BUILT_IN_FIELD_API_MAP: Record<string, string> = Object.fromEntries(
  VENDOR_BUILT_IN_FIELDS.map((f) => [f.fieldKey, getBuiltInApiKey(f)]),
);

const REGISTRY_BY_ENTITY: Record<CustomFieldEntityType, BuiltInFieldDefinition[]> = {
  vendor: VENDOR_BUILT_IN_FIELDS,
  item: ITEM_BUILT_IN_FIELDS,
};

export function getBuiltInFields(entityType: CustomFieldEntityType): BuiltInFieldDefinition[] {
  return [...(REGISTRY_BY_ENTITY[entityType] ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getBuiltInField(
  entityType: CustomFieldEntityType,
  fieldKey: string,
): BuiltInFieldDefinition | undefined {
  return getBuiltInFields(entityType).find((f) => f.fieldKey === fieldKey);
}

export function isSupportedFormConfigurationEntity(
  entityType: string,
): entityType is CustomFieldEntityType {
  return entityType in REGISTRY_BY_ENTITY && (REGISTRY_BY_ENTITY[entityType as CustomFieldEntityType]?.length ?? 0) > 0;
}

export function resolveBuiltInVisibility(
  field: BuiltInFieldDefinition,
  overrides: Map<string, boolean>,
): boolean {
  if (!field.configurable) {
    return field.defaultVisible;
  }
  const override = overrides.get(field.fieldKey);
  return override !== undefined ? override : field.defaultVisible;
}
