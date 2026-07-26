export const CUSTOM_FIELD_ENTITY_TYPES = ['vendor'] as const;

export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];

/** Types accepted and fully enforced on Vendor save (Phase CREATE v1). */
export const CUSTOM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'decimal',
  'date',
  'email',
  'phone',
  'dropdown',
  'checkbox',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** Types accepted in DTO later — rejected with 400 for now. */
export const CUSTOM_FIELD_TYPES_NOT_IMPLEMENTED = [
  'currency',
  'percentage',
  'datetime',
  'time',
  'toggle',
  'radio',
  'multi_select',
  'url',
  'file',
  'image',
  'lookup',
  'auto_number',
  'formula',
] as const;

/** Maps entityType → product module for form-schema permission. */
export const ENTITY_TYPE_MODULE_MAP: Record<CustomFieldEntityType, string> = {
  vendor: 'supply-chain',
};

export const FIELD_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;

export interface CustomFieldOption {
  value: string;
  label: string;
  displayOrder?: number;
}

export interface CustomFieldValidationRules {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  regex?: string;
  unique?: boolean;
  allowDecimal?: boolean;
}

export interface ModuleSectionDef {
  key: string;
  label: string;
}

export interface CustomFieldModuleMeta {
  entityType: CustomFieldEntityType;
  label: string;
  productModule: string;
  sections: ModuleSectionDef[];
}

/** Vendor form sections (FE tabs). Unknown sectionKey → treat as "custom". */
export const VENDOR_SECTIONS: ModuleSectionDef[] = [
  { key: 'general', label: 'General' },
  { key: 'contact', label: 'Contact Details' },
  { key: 'address', label: 'Address' },
  { key: 'payment', label: 'Payment Terms' },
  { key: 'paymentRun', label: 'Payment Run / Tax' },
  { key: 'accounting', label: 'Bank / Accounting' },
  { key: 'remarks', label: 'Attachments / Remarks' },
  { key: 'custom', label: 'Custom' },
];

export const CUSTOM_FIELD_MODULES: CustomFieldModuleMeta[] = [
  {
    entityType: 'vendor',
    label: 'Vendor',
    productModule: 'supply-chain',
    sections: VENDOR_SECTIONS,
  },
];

/** Core Vendor API / Prisma keys — cannot be used as custom fieldName. */
export const VENDOR_RESERVED_CORE_KEYS = [
  'id',
  'code',
  'vendorCode',
  'vendorId',
  'companyId',
  'name',
  'email',
  'phone',
  'address',
  'city',
  'country',
  'taxId',
  'gstNumber',
  'gst',
  'panNumber',
  'pan',
  'isActive',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'deletedAt',
  'deletedBy',
  'rowVersion',
  'metadata',
  'customFields',
] as const;

/** FE SAP-style metadata keys (config-vendor) — cannot be custom fieldName. */
export const VENDOR_RESERVED_METADATA_KEYS = [
  'foreignName',
  'aliasName',
  'group',
  'currency',
  'bpType',
  'industry',
  'tel2',
  'mobile',
  'fax',
  'website',
  'shippingType',
  'contactPerson',
  'paymentTerms',
  'paymentMethod',
  'bankName',
  'bankAccount',
  'bankBranch',
  'iban',
  'swift',
  'creditLimit',
  'discountPercent',
  'priceList',
  'paymentBlock',
  'houseBank',
  'glAccount',
  'taxGroup',
  'withholdingTax',
  'reconciliationAccount',
  'remarks',
  'notes',
  'internalNotes',
  'singlePayment',
  'affiliate',
] as const;

export const VENDOR_RESERVED_FIELD_NAMES: readonly string[] = [
  ...VENDOR_RESERVED_CORE_KEYS,
  ...VENDOR_RESERVED_METADATA_KEYS,
];

/**
 * Friendly standard-field labels (normalized lowercase → display label).
 * Blocks create when displayName matches a standard Vendor field.
 */
export const VENDOR_RESERVED_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  id: 'Id',
  'vendor code': 'Vendor Code',
  'vendor name': 'Vendor Name',
  name: 'Vendor Name',
  email: 'Email',
  phone: 'Phone',
  mobile: 'Mobile',
  address: 'Address',
  city: 'City',
  country: 'Country',
  'gst number': 'GST Number',
  gst: 'GST Number',
  gstnumber: 'GST Number',
  'pan number': 'PAN Number',
  pan: 'PAN Number',
  pannumber: 'PAN Number',
  'tax id': 'Tax ID',
  taxid: 'Tax ID',
  'payment terms': 'Payment Terms',
  paymentterms: 'Payment Terms',
  currency: 'Currency',
  'contact person': 'Contact Person',
  contactperson: 'Contact Person',
  website: 'Website',
  remarks: 'Remarks',
  notes: 'Notes',
  metadata: 'Metadata',
  'custom fields': 'Custom Fields',
  customfields: 'Custom Fields',
  'created at': 'Created At',
  createdat: 'Created At',
  'updated at': 'Updated At',
  updatedat: 'Updated At',
  'deleted at': 'Deleted At',
  deletedat: 'Deleted At',
  'company id': 'Company Id',
  companyid: 'Company Id',
  'vendor id': 'Vendor Id',
  vendorid: 'Vendor Id',
};

/** fieldName (lowercase) → friendly standard label for error messages */
export const VENDOR_RESERVED_FIELD_LABELS: Readonly<Record<string, string>> = {
  id: 'Id',
  code: 'Vendor Code',
  vendorcode: 'Vendor Code',
  vendorid: 'Vendor Id',
  companyid: 'Company Id',
  name: 'Vendor Name',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  city: 'City',
  country: 'Country',
  taxid: 'Tax ID',
  gstnumber: 'GST Number',
  gst: 'GST Number',
  pannumber: 'PAN Number',
  pan: 'PAN Number',
  isactive: 'Active',
  createdat: 'Created At',
  updatedat: 'Updated At',
  createdby: 'Created By',
  updatedby: 'Updated By',
  deletedat: 'Deleted At',
  deletedby: 'Deleted By',
  metadata: 'Metadata',
  customfields: 'Custom Fields',
  currency: 'Currency',
  paymentterms: 'Payment Terms',
  contactperson: 'Contact Person',
  mobile: 'Mobile',
  website: 'Website',
  remarks: 'Remarks',
  notes: 'Notes',
};

export function getReservedFieldNames(entityType: CustomFieldEntityType): readonly string[] {
  if (entityType === 'vendor') return VENDOR_RESERVED_FIELD_NAMES;
  return [];
}

export function getReservedDisplayLabels(entityType: CustomFieldEntityType): readonly string[] {
  if (entityType !== 'vendor') return [];
  return [...new Set(Object.values(VENDOR_RESERVED_DISPLAY_LABELS))];
}

export function normalizeLabelKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isReservedFieldName(
  entityType: CustomFieldEntityType,
  fieldName: string,
): boolean {
  const lower = fieldName.toLowerCase();
  return getReservedFieldNames(entityType).some((k) => k.toLowerCase() === lower);
}

/** Returns friendly standard label if displayName is reserved; otherwise null. */
export function findReservedDisplayLabel(
  entityType: CustomFieldEntityType,
  displayName: string,
): string | null {
  if (entityType !== 'vendor') return null;
  const key = normalizeLabelKey(displayName);
  const compact = key.replace(/\s+/g, '');
  return (
    VENDOR_RESERVED_DISPLAY_LABELS[key] ??
    VENDOR_RESERVED_DISPLAY_LABELS[compact] ??
    null
  );
}

/** Friendly label for a reserved fieldName (falls back to fieldName). */
export function getReservedFieldLabel(
  entityType: CustomFieldEntityType,
  fieldName: string,
): string {
  if (entityType !== 'vendor') return fieldName;
  const lower = fieldName.toLowerCase();
  return VENDOR_RESERVED_FIELD_LABELS[lower] ?? fieldName;
}

/**
 * Require a known section for the module.
 * Throws via caller if invalid — returns key when valid.
 */
export function resolveRequiredSectionKey(
  entityType: CustomFieldEntityType,
  sectionKey?: string | null,
): string | null {
  if (!sectionKey || !sectionKey.trim()) return null;
  const key = sectionKey.trim();
  const mod = CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType);
  if (!mod) return null;
  return mod.sections.some((s) => s.key === key) ? key : null;
}

/** @deprecated Prefer resolveRequiredSectionKey — kept for callers that still soft-fallback. */
export function normalizeSectionKey(
  entityType: CustomFieldEntityType,
  sectionKey?: string | null,
): string {
  return resolveRequiredSectionKey(entityType, sectionKey) ?? 'custom';
}

/** "Factory Capacity" → factoryCapacity */
export function slugifyFieldName(displayName: string): string {
  const parts = displayName
    .trim()
    .replace(/[^a-zA-Z0-9\s_]/g, ' ')
    .split(/[\s_]+/)
    .filter(Boolean);
  if (parts.length === 0) return 'field';
  const [first, ...rest] = parts;
  let key =
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
  key = key.replace(/[^a-zA-Z0-9_]/g, '');
  if (!/^[a-zA-Z]/.test(key)) key = `f${key}`;
  return key.slice(0, 80);
}
