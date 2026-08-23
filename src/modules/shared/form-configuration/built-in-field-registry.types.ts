import { CustomFieldEntityType } from '../custom-fields/custom-fields.constants';

/** Where the field value is stored on the entity record. */
export type BuiltInFieldStorage =
  | { kind: 'core'; apiKey: string }
  | { kind: 'metadata'; metadataKey: string }
  | { kind: 'bag'; bag: string; bagKey: string };

export interface BuiltInFieldDefinition {
  fieldKey: string;
  label: string;
  entityType: CustomFieldEntityType;
  sectionKey: string;
  fieldType: string;
  defaultVisible: boolean;
  required: boolean;
  configurable: boolean;
  sortOrder: number;
  storage: BuiltInFieldStorage;
}

/** Stable fieldKey → API path (for FE + QA). */
export function getBuiltInApiKey(field: BuiltInFieldDefinition): string {
  if (field.storage.kind === 'core') return field.storage.apiKey;
  if (field.storage.kind === 'bag') return `${field.storage.bag}.${field.storage.bagKey}`;
  return `metadata.${field.storage.metadataKey}`;
}
