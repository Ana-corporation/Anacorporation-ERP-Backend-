/**
 * Tab registry for form UIs (Tab Access settings + form-schema filter).
 * tabKey is the allow-list key; form sectionKey may map onto a tabKey.
 * Does not replace RBAC — visibility only.
 */
import {
  CUSTOM_FIELD_MODULES,
  CustomFieldEntityType,
  ENTITY_TYPE_MODULE_MAP,
  ITEM_SECTIONS,
  ModuleSectionDef,
  VENDOR_SECTIONS,
} from '../custom-fields/custom-fields.constants';

export interface TabRegistryEntry {
  moduleCode: string;
  entityCode: CustomFieldEntityType;
  tabKey: string;
  label: string;
  displayOrder: number;
  isDefaultVisible: boolean;
  /** Optional existing permission code required in addition to module access. */
  requiredPermission?: string | null;
}

/**
 * Vendor Tab Access catalog (FE product tabs).
 * Keys must match form-schema filtering via mapSectionKeyToTabKey.
 */
export const VENDOR_TAB_ACCESS_SECTIONS: ModuleSectionDef[] = [
  { key: 'general', label: 'General' },
  { key: 'payment', label: 'Payment Terms' },
  { key: 'bank', label: 'Business Partner Bank' },
  { key: 'paymentRun', label: 'Payment Run' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'custom', label: 'Custom Fields' },
];

/**
 * Item Tab Access catalog — aligns with Item Master tabs.
 */
export const ITEM_TAB_ACCESS_SECTIONS: ModuleSectionDef[] = [...ITEM_SECTIONS];

/**
 * form-schema sectionKey → Tab Access tabKey.
 * Contact/address fields live under FE "General" tab.
 */
const VENDOR_SECTION_TO_TAB_KEY: Readonly<Record<string, string>> = {
  general: 'general',
  contact: 'general',
  address: 'general',
  payment: 'payment',
  bank: 'bank',
  paymentRun: 'paymentRun',
  accounting: 'accounting',
  remarks: 'remarks',
  attachments: 'attachments',
  custom: 'custom',
};

/** Legacy / FE alias → canonical tabKey */
const TAB_KEY_ALIASES: Readonly<Record<string, string>> = {
  general: 'general',
  contact: 'general',
  address: 'general',
  payment: 'payment',
  paymentterms: 'payment',
  payment_terms: 'payment',
  bank: 'bank',
  paymentrun: 'paymentRun',
  payment_run: 'paymentRun',
  accounting: 'accounting',
  remarks: 'remarks',
  attachments: 'attachments',
  attachment: 'attachments',
  custom: 'custom',
  customfields: 'custom',
  custom_fields: 'custom',
};

function toTabEntries(
  entityCode: CustomFieldEntityType,
  sections: ModuleSectionDef[],
): TabRegistryEntry[] {
  const moduleCode = ENTITY_TYPE_MODULE_MAP[entityCode];
  return sections.map((section, index) => ({
    moduleCode,
    entityCode,
    tabKey: section.key,
    label: section.label,
    displayOrder: index + 1,
    isDefaultVisible: true,
    requiredPermission: null,
  }));
}

const TAB_REGISTRY: TabRegistryEntry[] = [
  ...toTabEntries('vendor', VENDOR_TAB_ACCESS_SECTIONS),
  ...toTabEntries('item', ITEM_TAB_ACCESS_SECTIONS),
];

export function getTabRegistry(entityCode?: CustomFieldEntityType): TabRegistryEntry[] {
  if (!entityCode) return [...TAB_REGISTRY];
  return TAB_REGISTRY.filter((t) => t.entityCode === entityCode);
}

export function getTabDefinition(
  entityCode: CustomFieldEntityType,
  tabKey: string,
): TabRegistryEntry | undefined {
  const canonical = normalizeTabKey(entityCode, tabKey);
  if (!canonical) return undefined;
  return TAB_REGISTRY.find((t) => t.entityCode === entityCode && t.tabKey === canonical);
}

/** Normalize FE/legacy tabKey to canonical registry key; null if unknown. */
export function normalizeTabKey(
  entityCode: CustomFieldEntityType,
  tabKey: string,
): string | null {
  const raw = tabKey.trim();
  if (!raw) return null;

  if (entityCode === 'vendor') {
    const alias = TAB_KEY_ALIASES[raw.toLowerCase()] ?? TAB_KEY_ALIASES[raw];
    if (alias && getTabRegistry('vendor').some((t) => t.tabKey === alias)) {
      return alias;
    }
  }

  const exact = getTabRegistry(entityCode).find((t) => t.tabKey === raw);
  return exact?.tabKey ?? null;
}

/**
 * Map a form-schema / built-in sectionKey to the Tab Access allow-list key.
 */
export function mapSectionKeyToTabKey(
  entityCode: CustomFieldEntityType,
  sectionKey: string,
): string {
  const key = sectionKey.trim() || 'custom';
  if (entityCode === 'vendor') {
    return VENDOR_SECTION_TO_TAB_KEY[key] ?? key;
  }
  // Item: sectionKey === tabKey (plus attachments)
  if (key === 'attachment') return 'attachments';
  return key;
}

export function isSupportedTabEntity(entityType: string): entityType is CustomFieldEntityType {
  return CUSTOM_FIELD_MODULES.some((m) => m.entityType === entityType);
}

export function resolveEntityModuleCode(entityCode: CustomFieldEntityType): string {
  return ENTITY_TYPE_MODULE_MAP[entityCode];
}

/** Form field placement catalogs (unchanged — may include contact/address etc.). */
export function getFormSectionCatalog(entityCode: CustomFieldEntityType): ModuleSectionDef[] {
  if (entityCode === 'item') {
    const hasAttachments = ITEM_SECTIONS.some((s) => s.key === 'attachments');
    return hasAttachments
      ? [...ITEM_SECTIONS]
      : [
          ...ITEM_SECTIONS.filter((s) => s.key !== 'custom'),
          { key: 'attachments', label: 'Attachments' },
          { key: 'custom', label: 'Custom' },
        ];
  }
  const hasAttachments = VENDOR_SECTIONS.some((s) => s.key === 'attachments');
  return hasAttachments
    ? [...VENDOR_SECTIONS]
    : [
        ...VENDOR_SECTIONS.filter((s) => s.key !== 'custom'),
        { key: 'attachments', label: 'Attachments' },
        { key: 'custom', label: 'Custom' },
      ];
}
