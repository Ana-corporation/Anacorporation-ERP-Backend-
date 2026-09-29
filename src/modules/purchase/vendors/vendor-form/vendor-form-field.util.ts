import { CustomFieldDefinition } from '@prisma/client';
import {
  getBuiltInField,
  resolveBuiltInRegistrationVisibility,
} from '@/modules/shared/form-configuration/built-in-field-registry';
import { BuiltInFieldDefinition } from '@/modules/shared/form-configuration/built-in-field-registry.types';
import { VENDOR_SECTIONS } from '@/modules/shared/custom-fields/custom-fields.constants';
import { SUPPLIER_TYPES } from '../vendor-code.util';
import {
  VENDOR_FORM_INTERNAL_ONLY_FIELD_KEYS,
  VendorFieldFilledBy,
  VendorFormFieldSnapshotMap,
} from './vendor-form.constants';

export type VendorFormFieldOption = { value: string; label: string };

/** Types sent to the public form: text|textarea|number|decimal|date|email|phone|dropdown|checkbox. */
export type VendorFormFieldDefinition = {
  key: string;
  label: string;
  fieldType: string;
  sectionKey: string;
  required: boolean;
  editable: boolean;
  source: 'BUILTIN' | 'CUSTOM';
  sortOrder: number;
  helpText: string;
  options?: VendorFormFieldOption[];
};

/** Built-in contact numbers the Add Vendor form stores as E.164. */
export const BUILT_IN_PHONE_FIELD_KEYS: ReadonlySet<string> = new Set(['phone', 'tel2', 'mobile']);

export const VENDOR_NAME_FIELD_KEY = 'vendorName';
export const SUPPLIER_TYPE_FIELD_KEY = 'vendorCategory';
export const VENDOR_CODE_FIELD_KEY = 'supplierCode';

/** Built-in fields the vendor must fill on a draft (Send Vendor Registration) invitation. */
export const DRAFT_VENDOR_REQUIRED_FIELD_KEYS = [
  VENDOR_NAME_FIELD_KEY,
  SUPPLIER_TYPE_FIELD_KEY,
] as const;

const SUPPLIER_TYPE_OPTIONS: VendorFormFieldOption[] = SUPPLIER_TYPES.map((value) => ({
  value,
  label: value,
}));

/** Drafts need Name and Supplier type from the vendor, even though Supplier type is staff-only otherwise. */
export function applyDraftVendorFieldRules(
  fieldDefs: VendorFormFieldDefinition[],
): VendorFormFieldDefinition[] {
  const draftKeys = new Set<string>(DRAFT_VENDOR_REQUIRED_FIELD_KEYS);
  const missing = DRAFT_VENDOR_REQUIRED_FIELD_KEYS.filter(
    (key) => !fieldDefs.some((field) => field.key === key),
  )
    .map((key) => getBuiltInField('vendor', key))
    .filter((field): field is BuiltInFieldDefinition => Boolean(field))
    .map(mapBuiltInToFormField);

  return sortVendorFormFields([...fieldDefs, ...missing]).map((field) =>
    draftKeys.has(field.key) ? { ...field, editable: true, required: true } : field,
  );
}

/** Drafts store the email as a placeholder name and a DR### code; the vendor must not see them. */
export function blankDraftVendorSnapshot(
  snapshot: VendorFormFieldSnapshotMap,
): VendorFormFieldSnapshotMap {
  const next = { ...snapshot };
  for (const key of [...DRAFT_VENDOR_REQUIRED_FIELD_KEYS, VENDOR_CODE_FIELD_KEY]) {
    if (key in next) next[key] = { value: '', filledBy: null };
  }
  return next;
}

export function readVendorCoreValue(
  vendor: Record<string, unknown>,
  apiKey: string,
): unknown {
  return vendor[apiKey];
}

export function readVendorFieldValue(
  vendor: Record<string, unknown>,
  fieldKey: string,
  customFields: Record<string, unknown>,
): unknown {
  const builtIn = getBuiltInField('vendor', fieldKey);
  if (!builtIn) {
    return customFields[fieldKey];
  }

  if (builtIn.storage.kind === 'core') {
    return readVendorCoreValue(vendor, builtIn.storage.apiKey);
  }

  const metadata =
    vendor.metadata && typeof vendor.metadata === 'object' && !Array.isArray(vendor.metadata)
      ? (vendor.metadata as Record<string, unknown>)
      : {};

  if (builtIn.storage.kind === 'metadata') {
    return metadata[builtIn.storage.metadataKey];
  }

  return undefined;
}

export function isFieldEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function buildFieldSnapshot(
  vendor: Record<string, unknown>,
  customFields: Record<string, unknown>,
  fieldDefs: VendorFormFieldDefinition[],
): VendorFormFieldSnapshotMap {
  const snapshot: VendorFormFieldSnapshotMap = {};

  for (const field of fieldDefs) {
    const value = readVendorFieldValue(vendor, field.key, customFields);
    snapshot[field.key] = {
      value: value ?? '',
      filledBy: isFieldEmpty(value) ? null : 'INTERNAL',
    };
  }

  return snapshot;
}

/** Registry "select" fields without backend options go out as text; the FE catalog supplies known lists. */
function publicBuiltInFieldType(field: BuiltInFieldDefinition, hasOptions: boolean): string {
  if (BUILT_IN_PHONE_FIELD_KEYS.has(field.fieldKey)) return 'phone';
  if (field.fieldType === 'select') return hasOptions ? 'dropdown' : 'text';
  return field.fieldType;
}

export function mapBuiltInToFormField(field: BuiltInFieldDefinition): VendorFormFieldDefinition {
  const options = field.fieldKey === SUPPLIER_TYPE_FIELD_KEY ? SUPPLIER_TYPE_OPTIONS : undefined;
  return {
    key: field.fieldKey,
    label: field.label,
    fieldType: publicBuiltInFieldType(field, Boolean(options)),
    sectionKey: field.sectionKey,
    required: field.required,
    editable: !VENDOR_FORM_INTERNAL_ONLY_FIELD_KEYS.has(field.fieldKey),
    source: 'BUILTIN',
    sortOrder: field.sortOrder,
    helpText: '',
    ...(options ? { options } : {}),
  };
}

function customFieldOptions(raw: unknown): VendorFormFieldOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options = raw
    .filter(
      (item): item is { value: unknown; label?: unknown; displayOrder?: unknown } =>
        Boolean(item) && typeof item === 'object' && 'value' in item,
    )
    .map((item, index) => ({
      value: String(item.value),
      label: item.label ? String(item.label) : String(item.value),
      order: typeof item.displayOrder === 'number' ? item.displayOrder : index,
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ value, label }) => ({ value, label }));
  return options.length ? options : undefined;
}

export function mapCustomToFormField(def: CustomFieldDefinition): VendorFormFieldDefinition {
  const options = customFieldOptions(def.options);
  return {
    key: def.fieldName,
    label: def.displayName,
    fieldType: def.fieldType,
    sectionKey: def.sectionKey ?? 'custom',
    required: def.isRequired,
    editable: !def.isReadOnly,
    source: 'CUSTOM',
    sortOrder: def.sortOrder,
    helpText: def.helpText ?? def.placeholder ?? '',
    ...(options ? { options } : {}),
  };
}

export function filterRegistrationBuiltInFields(
  registry: BuiltInFieldDefinition[],
  visibilityOverrides: Map<string, boolean>,
  registrationOverrides: Map<string, boolean>,
): VendorFormFieldDefinition[] {
  return registry
    .filter((field) =>
      resolveBuiltInRegistrationVisibility(field, visibilityOverrides, registrationOverrides),
    )
    .map(mapBuiltInToFormField);
}

const SECTION_ORDER = new Map(VENDOR_SECTIONS.map((section, index) => [section.key, index]));

/** Add Vendor order: section order, then built-in before custom, then sortOrder. */
export function sortVendorFormFields(
  fieldDefs: VendorFormFieldDefinition[],
): VendorFormFieldDefinition[] {
  const sectionIndex = (key: string) => SECTION_ORDER.get(key) ?? SECTION_ORDER.size;
  return [...fieldDefs].sort(
    (a, b) =>
      sectionIndex(a.sectionKey) - sectionIndex(b.sectionKey) ||
      Number(a.source === 'CUSTOM') - Number(b.source === 'CUSTOM') ||
      a.sortOrder - b.sortOrder,
  );
}

export function splitSubmittedFields(
  fields: Record<string, unknown>,
  fieldDefs: VendorFormFieldDefinition[],
): {
  core: Record<string, unknown>;
  metadata: Record<string, unknown>;
  customFields: Record<string, unknown>;
} {
  const allowed = new Set(fieldDefs.map((f) => f.key));
  const core: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key)) continue;

    const builtIn = getBuiltInField('vendor', key);
    if (!builtIn) {
      customFields[key] = value;
      continue;
    }

    if (builtIn.storage.kind === 'core') {
      core[builtIn.storage.apiKey] = value;
    } else if (builtIn.storage.kind === 'metadata') {
      metadata[builtIn.storage.metadataKey] = value;
    }
  }

  return { core, metadata, customFields };
}

export function mergeFieldSnapshotAfterSubmit(
  snapshot: VendorFormFieldSnapshotMap,
  submitted: Record<string, unknown>,
): VendorFormFieldSnapshotMap {
  const next: VendorFormFieldSnapshotMap = { ...snapshot };

  for (const [key, value] of Object.entries(submitted)) {
    if (!(key in next)) continue;
    next[key] = {
      value,
      filledBy: 'VENDOR' satisfies VendorFieldFilledBy,
    };
  }

  return next;
}

export function toPublicFormFields(
  fieldDefs: VendorFormFieldDefinition[],
  snapshot: VendorFormFieldSnapshotMap,
) {
  return fieldDefs.map((field) => {
    const entry = snapshot[field.key] ?? { value: '', filledBy: null };
    return {
      key: field.key,
      name: field.key,
      label: field.label,
      fieldType: field.fieldType,
      type: field.fieldType,
      sectionKey: field.sectionKey,
      section: field.sectionKey,
      required: field.required,
      editable: field.editable,
      readOnly: !field.editable,
      source: field.source,
      helpText: field.helpText,
      ...(field.options ? { options: field.options } : {}),
      value: entry.value ?? '',
      filledBy: entry.filledBy,
    };
  });
}
