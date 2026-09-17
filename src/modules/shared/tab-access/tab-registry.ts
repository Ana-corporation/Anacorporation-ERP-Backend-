/**
 * Tab registry for form UIs.
 * tabKey === existing sectionKey (Vendor/Item FE tabs).
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
  ...toTabEntries('vendor', VENDOR_SECTIONS),
  ...toTabEntries('item', ITEM_SECTIONS),
];

export function getTabRegistry(entityCode?: CustomFieldEntityType): TabRegistryEntry[] {
  if (!entityCode) return [...TAB_REGISTRY];
  return TAB_REGISTRY.filter((t) => t.entityCode === entityCode);
}

export function getTabDefinition(
  entityCode: CustomFieldEntityType,
  tabKey: string,
): TabRegistryEntry | undefined {
  return TAB_REGISTRY.find((t) => t.entityCode === entityCode && t.tabKey === tabKey);
}

export function isSupportedTabEntity(entityType: string): entityType is CustomFieldEntityType {
  return CUSTOM_FIELD_MODULES.some((m) => m.entityType === entityType);
}

export function resolveEntityModuleCode(entityCode: CustomFieldEntityType): string {
  return ENTITY_TYPE_MODULE_MAP[entityCode];
}
