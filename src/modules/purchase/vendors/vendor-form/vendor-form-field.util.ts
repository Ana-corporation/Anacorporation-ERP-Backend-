import { getBuiltInField, resolveBuiltInVisibility } from '@/modules/shared/form-configuration/built-in-field-registry';
import { BuiltInFieldDefinition } from '@/modules/shared/form-configuration/built-in-field-registry.types';
import {
  VENDOR_FORM_INTERNAL_ONLY_FIELD_KEYS,
  VendorFieldFilledBy,
  VendorFormFieldSnapshot,
  VendorFormFieldSnapshotMap,
} from './vendor-form.constants';

export type VendorFormFieldDefinition = {
  key: string;
  label: string;
  fieldType: string;
  sectionKey: string;
  required: boolean;
  editable: boolean;
  source: 'BUILTIN' | 'CUSTOM';
};

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

export function mapBuiltInToFormField(field: BuiltInFieldDefinition): VendorFormFieldDefinition {
  return {
    key: field.fieldKey,
    label: field.label,
    fieldType: field.fieldType,
    sectionKey: field.sectionKey,
    required: field.required,
    editable: !VENDOR_FORM_INTERNAL_ONLY_FIELD_KEYS.has(field.fieldKey),
    source: 'BUILTIN',
  };
}

export function filterVisibleBuiltInFields(
  registry: BuiltInFieldDefinition[],
  overrides: Map<string, boolean>,
): VendorFormFieldDefinition[] {
  return registry
    .filter((field) => resolveBuiltInVisibility(field, overrides))
    .map(mapBuiltInToFormField);
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
      label: field.label,
      fieldType: field.fieldType,
      sectionKey: field.sectionKey,
      required: field.required,
      editable: field.editable,
      source: field.source,
      value: entry.value ?? '',
      filledBy: entry.filledBy,
    };
  });
}
