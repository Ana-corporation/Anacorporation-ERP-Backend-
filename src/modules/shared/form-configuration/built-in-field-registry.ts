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

type FieldOpts = Partial<
  Pick<BuiltInFieldDefinition, 'defaultVisible' | 'required' | 'configurable' | 'aliases'>
>;

function meta(
  fieldKey: string,
  label: string,
  sectionKey: string,
  metadataKey: string,
  fieldType: string,
  sortOrder: number,
  opts: FieldOpts = {},
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
    ...(opts.aliases?.length ? { aliases: opts.aliases } : {}),
  });
}

function core(
  fieldKey: string,
  label: string,
  sectionKey: string,
  apiKey: string,
  fieldType: string,
  sortOrder: number,
  opts: FieldOpts = {},
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
    ...(opts.aliases?.length ? { aliases: opts.aliases } : {}),
  });
}

/**
 * Developer-controlled registry of standard Vendor form fields.
 * Company admins may only toggle visibility on configurable fields.
 * GET Form Configuration returns every row here (including visible:false).
 */
export const VENDOR_BUILT_IN_FIELDS: BuiltInFieldDefinition[] = [
  // —— General / identity ——
  core('vendorName', 'Name', 'general', 'name', 'text', 10, {
    required: true,
    configurable: false,
  }),
  core('supplierCode', 'Code', 'general', 'vendorCode', 'text', 20, {
    required: true,
    configurable: false,
    aliases: ['vendorCode', 'supplier_code'],
  }),
  core('vendorCategory', 'Supplier type', 'general', 'supplierType', 'select', 30, {
    required: true,
    configurable: false,
    aliases: ['supplierType', 'vendor_category'],
  }),
  meta('foreignName', 'Foreign name', 'general', 'foreignName', 'text', 40),
  meta('aliasName', 'Alias name', 'general', 'aliasName', 'text', 50),
  meta('group', 'Group', 'general', 'group', 'text', 60),
  meta('currency', 'Currency', 'general', 'currency', 'text', 70),
  meta('bpType', 'Business partner type', 'general', 'bpType', 'select', 80),
  meta('industry', 'Industry', 'general', 'industry', 'text', 90),
  core('federalTaxId', 'Federal Tax ID', 'general', 'taxId', 'text', 95, {
    aliases: ['taxId', 'tax_id'],
  }),
  core('isActive', 'Active', 'general', 'isActive', 'checkbox', 100),

  // —— Contact ——
  // FE PhoneInput: country code is UI-only, not a registry field.
  core('email', 'E-Mail', 'contact', 'email', 'email', 110),
  core('phone', 'Tel 1', 'contact', 'phone', 'text', 120),
  meta('tel2', 'Tel 2', 'contact', 'tel2', 'text', 130),
  meta('mobile', 'Mobile phone', 'contact', 'mobile', 'text', 140),
  meta('fax', 'Fax', 'contact', 'fax', 'text', 150),
  meta('website', 'Web site', 'contact', 'website', 'text', 160),
  meta('shippingType', 'Shipping type', 'contact', 'shippingType', 'select', 170),
  meta('contactPerson', 'Contact person', 'contact', 'contactPerson', 'text', 180),

  // —— Address (Address Line 1/2/3 and State are CUSTOM — not listed here) ——
  core('address', 'Address', 'address', 'address', 'textarea', 210),
  core('city', 'City', 'address', 'city', 'text', 220),
  core('country', 'Country', 'address', 'country', 'text', 230),

  // —— Payment Terms ——
  meta('paymentTerms', 'Payment terms', 'payment', 'paymentTerms', 'select', 310),
  meta('paymentMethod', 'Payment Method', 'payment', 'paymentMethod', 'select', 320),
  meta('interestArrears', 'Interest on arrears %', 'payment', 'interestArrears', 'number', 330),
  meta('priceList', 'Price list', 'payment', 'priceList', 'text', 340),
  meta('totalDiscount', 'Total discount %', 'payment', 'totalDiscount', 'number', 350, {
    aliases: ['discountPercent'],
  }),
  meta('creditLimit', 'Credit limit', 'payment', 'creditLimit', 'number', 360),
  meta('commitmentLimit', 'Commitment limit', 'payment', 'commitmentLimit', 'number', 370),
  meta('effectiveDiscount', 'Effective discount', 'payment', 'effectiveDiscount', 'number', 380),
  meta('dunningTerm', 'Dunning term', 'payment', 'dunningTerm', 'select', 390),

  // —— Business Partner Bank ——
  meta('bankCountry', 'Bank country', 'bank', 'bankCountry', 'text', 410),
  meta('bankName', 'Bank name', 'bank', 'bankName', 'text', 420),
  meta('bankCode', 'Bank code', 'bank', 'bankCode', 'text', 430),
  meta('bankAccount', 'Account', 'bank', 'bankAccount', 'text', 440),
  meta('bankBranch', 'Branch', 'bank', 'bankBranch', 'text', 450),
  meta('bankSwift', 'BIC/SWIFT code', 'bank', 'bankSwift', 'text', 460, {
    aliases: ['swift'],
  }),
  meta('bankIban', 'IBAN', 'bank', 'bankIban', 'text', 470, {
    aliases: ['iban'],
  }),

  // —— Payment Run ——
  meta('houseBankCountry', 'Country', 'paymentRun', 'houseBankCountry', 'text', 510),
  meta('houseBank', 'Bank', 'paymentRun', 'houseBank', 'text', 520),
  meta('houseBankAccount', 'Account', 'paymentRun', 'houseBankAccount', 'text', 530),
  meta('houseBankBranch', 'Branch', 'paymentRun', 'houseBankBranch', 'text', 540),
  meta('houseBankIban', 'IBAN', 'paymentRun', 'houseBankIban', 'text', 550),
  meta('houseBankSwift', 'BIC/SWIFT code', 'paymentRun', 'houseBankSwift', 'text', 560),
  meta('referenceDetails', 'Reference details', 'paymentRun', 'referenceDetails', 'text', 570),
  meta('paymentBlock', 'Payment block', 'paymentRun', 'paymentBlock', 'checkbox', 580),
  meta('singlePayment', 'Single payment', 'paymentRun', 'singlePayment', 'checkbox', 590),
  meta('taxGroup', 'Tax Group', 'paymentRun', 'taxGroup', 'select', 595),
  meta('withholdingTax', 'Withholding Tax', 'paymentRun', 'withholdingTax', 'text', 596),

  // —— Accounting ——
  meta('consolidatingBp', 'Consolidating BP', 'accounting', 'consolidatingBp', 'text', 610),
  meta('planningGroup', 'Planning group', 'accounting', 'planningGroup', 'text', 620),
  meta('accountsPayable', 'Accounts payable', 'accounting', 'accountsPayable', 'text', 630),
  meta('downPaymentClearing', 'Down payment clearing account', 'accounting', 'downPaymentClearing', 'text', 640),
  meta('downPaymentInterim', 'Down payment interim account', 'accounting', 'downPaymentInterim', 'text', 650),
  meta('affiliate', 'Affiliate', 'accounting', 'affiliate', 'text', 660),
  meta('glAccount', 'G/L Account', 'accounting', 'glAccount', 'text', 670),
  meta('reconciliationAccount', 'Reconciliation Account', 'accounting', 'reconciliationAccount', 'text', 680),

  // —— Remarks (Attachments tab is a file panel — not a registry field) ——
  meta('remarks', 'Remarks', 'remarks', 'remarks', 'textarea', 710),
  meta('notes', 'Notes', 'remarks', 'notes', 'textarea', 720),
  meta('internalNotes', 'Internal Notes', 'remarks', 'internalNotes', 'textarea', 730),
];

/** fieldKey → API path map (canonical keys plus aliases). */
export const VENDOR_BUILT_IN_FIELD_API_MAP: Record<string, string> = Object.fromEntries(
  VENDOR_BUILT_IN_FIELDS.flatMap((f) => {
    const apiKey = getBuiltInApiKey(f);
    return [[f.fieldKey, apiKey], ...(f.aliases ?? []).map((alias) => [alias, apiKey])];
  }),
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
  return getBuiltInFields(entityType).find(
    (f) => f.fieldKey === fieldKey || (f.aliases?.includes(fieldKey) ?? false),
  );
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
  if (overrides.has(field.fieldKey)) {
    return overrides.get(field.fieldKey)!;
  }
  for (const alias of field.aliases ?? []) {
    if (overrides.has(alias)) {
      return overrides.get(alias)!;
    }
  }
  return field.defaultVisible;
}

export function fieldHasOverride(
  field: BuiltInFieldDefinition,
  overrides: Map<string, boolean>,
): boolean {
  if (overrides.has(field.fieldKey)) return true;
  return (field.aliases ?? []).some((alias) => overrides.has(alias));
}
