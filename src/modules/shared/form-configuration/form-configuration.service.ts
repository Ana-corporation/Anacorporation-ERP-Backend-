import { HttpStatus, Injectable } from '@nestjs/common';
import { BusinessException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import {
  CUSTOM_FIELD_MODULES,
  CustomFieldEntityType,
  ITEM_SECTIONS,
  VENDOR_SECTIONS,
} from '../custom-fields/custom-fields.constants';
import {
  BuiltInFieldDefinition,
  getBuiltInApiKey,
  getBuiltInField,
  getBuiltInFields,
  isBuiltInRegistrationConfigurable,
  isSupportedFormConfigurationEntity,
  lookupOverride,
  resolveBuiltInRegistrationVisibility,
  resolveBuiltInVisibility,
  fieldHasOverride,
} from './built-in-field-registry';
import { UpdateFormConfigurationDto } from './dto/form-configuration.dto';
import { FormConfigurationRepository } from './form-configuration.repository';
import { resolveVendorSectionDefsForCompany } from './ana-vendor-section-labels';
import { TabAccessService } from '../tab-access/tab-access.service';

export interface BuiltInFieldConfigurationItem {
  fieldKey: string;
  label: string;
  sectionKey: string;
  fieldType: string;
  apiKey: string;
  visible: boolean;
  required: boolean;
  configurable: boolean;
  source: 'BUILT_IN';
  hasOverride: boolean;
  registrationVisible: boolean;
  registrationConfigurable: boolean;
}

export interface FieldOverrideMaps {
  visibility: Map<string, boolean>;
  registration: Map<string, boolean>;
}

export interface FormConfigurationSection {
  sectionKey: string;
  label: string;
  fields: BuiltInFieldConfigurationItem[];
}

@Injectable()
export class FormConfigurationService {
  constructor(
    private readonly repository: FormConfigurationRepository,
    private readonly tabAccessService: TabAccessService,
  ) {}

  assertSupportedEntity(entityType: string): CustomFieldEntityType {
    if (!isSupportedFormConfigurationEntity(entityType)) {
      throw new BusinessException(
        `Form configuration is not supported for entity type: ${entityType}`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'entityType', message: `Unsupported entity type: ${entityType}` }],
        'ENTITY_TYPE_NOT_SUPPORTED',
      );
    }
    return entityType;
  }

  async getConfiguration(companyId: string, entityType: string) {
    const resolvedEntity = this.assertSupportedEntity(entityType);
    const registry = getBuiltInFields(resolvedEntity);
    const overrides = await this.loadFieldOverrides(companyId, resolvedEntity);
    const isRegistrationTab = await this.tabAccessService.getRegistrationSectionFilter(
      companyId,
      resolvedEntity,
    );
    const sections = this.groupBuiltInConfiguration(
      companyId,
      resolvedEntity,
      registry,
      overrides,
      isRegistrationTab,
    );

    return serialize({
      entityType: resolvedEntity,
      sections,
    });
  }

  async updateConfiguration(
    companyId: string,
    entityType: string,
    dto: UpdateFormConfigurationDto,
  ) {
    const resolvedEntity = this.assertSupportedEntity(entityType);
    const overrides = await this.loadFieldOverrides(companyId, resolvedEntity);
    const isRegistrationTab = await this.tabAccessService.getRegistrationSectionFilter(
      companyId,
      resolvedEntity,
    );

    for (const row of dto.fields) {
      const field = getBuiltInField(resolvedEntity, row.fieldKey);
      if (!field) {
        throw new BusinessException(
          `Unknown built-in field: ${row.fieldKey}`,
          HttpStatus.BAD_REQUEST,
          [{ field: 'fieldKey', message: `Unknown built-in field: ${row.fieldKey}` }],
          'INVALID_FIELD_KEY',
        );
      }

      if (!field.configurable && row.isVisible !== undefined && row.isVisible !== field.defaultVisible) {
        throw new BusinessException(
          `${field.label} is a protected field and cannot be hidden.`,
          HttpStatus.BAD_REQUEST,
          [
            {
              field: 'fieldKey',
              message: `${field.label} is a protected field and cannot be hidden.`,
            },
          ],
          'PROTECTED_FIELD_CANNOT_HIDE',
        );
      }

      const visible = field.configurable
        ? (row.isVisible ?? resolveBuiltInVisibility(field, overrides.visibility))
        : field.defaultVisible;
      const visibleOverride = visible === field.defaultVisible ? null : visible;

      // Registration defaults to on for Add-visible fields, so only "off" is stored.
      // Locked fields ignore the requested value and keep any saved one for when they unlock.
      const nextVisibility = new Map<string, boolean>(
        visibleOverride === null ? [] : [[field.fieldKey, visibleOverride]],
      );
      const registrationOff =
        row.isRegistrationVisible !== undefined &&
        isRegistrationTab(field.sectionKey) &&
        isBuiltInRegistrationConfigurable(field, nextVisibility)
          ? !row.isRegistrationVisible
          : lookupOverride(field, overrides.registration) === false;
      const registrationOverride = registrationOff ? false : null;

      if (visibleOverride === null && registrationOverride === null) {
        await this.repository.deleteOverride(companyId, resolvedEntity, field.fieldKey);
      } else {
        await this.repository.upsertOverride(companyId, resolvedEntity, field.fieldKey, {
          isVisible: visibleOverride,
          isRegistrationVisible: registrationOverride,
        });
      }
      for (const alias of field.aliases ?? []) {
        await this.repository.deleteOverride(companyId, resolvedEntity, alias);
      }
    }

    return this.getConfiguration(companyId, resolvedEntity);
  }

  async resetConfiguration(companyId: string, entityType: string) {
    const resolvedEntity = this.assertSupportedEntity(entityType);
    await this.repository.deleteAllOverrides(companyId, resolvedEntity);
    return this.getConfiguration(companyId, resolvedEntity);
  }

  async loadFieldOverrides(
    companyId: string,
    entityType: CustomFieldEntityType,
  ): Promise<FieldOverrideMaps> {
    const rows = await this.repository.findOverrides(companyId, entityType);
    const visibility = new Map<string, boolean>();
    const registration = new Map<string, boolean>();
    for (const row of rows) {
      if (typeof row.isVisible === 'boolean') visibility.set(row.fieldKey, row.isVisible);
      if (typeof row.isRegistrationVisible === 'boolean') {
        registration.set(row.fieldKey, row.isRegistrationVisible);
      }
    }
    return { visibility, registration };
  }

  async loadOverrideMap(companyId: string, entityType: CustomFieldEntityType) {
    return (await this.loadFieldOverrides(companyId, entityType)).visibility;
  }

  toBuiltInSchemaField(field: BuiltInFieldDefinition, overrides: FieldOverrideMaps) {
    const visible = resolveBuiltInVisibility(field, overrides.visibility);
    return {
      key: field.fieldKey,
      label: field.label,
      fieldType: field.fieldType,
      sectionKey: field.sectionKey,
      apiKey: getBuiltInApiKey(field),
      source: 'BUILT_IN' as const,
      visible,
      required: field.required,
      configurable: field.configurable,
      ...this.registrationState(field, overrides),
      storage: field.storage,
    };
  }

  /** A tab switched off for registration hides and locks every field inside it. */
  registrationState(field: BuiltInFieldDefinition, overrides: FieldOverrideMaps, tabOn = true) {
    return {
      registrationVisible:
        tabOn &&
        resolveBuiltInRegistrationVisibility(field, overrides.visibility, overrides.registration),
      registrationConfigurable:
        tabOn && isBuiltInRegistrationConfigurable(field, overrides.visibility),
    };
  }

  groupBuiltInConfiguration(
    companyId: string,
    entityType: CustomFieldEntityType,
    registry: BuiltInFieldDefinition[],
    overrides: FieldOverrideMaps,
    isRegistrationTab: (sectionKey: string) => boolean = () => true,
  ): FormConfigurationSection[] {
    const baseSectionDefs =
      CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType)?.sections ??
      (entityType === 'item' ? ITEM_SECTIONS : VENDOR_SECTIONS);
    const sectionDefs =
      entityType === 'vendor'
        ? resolveVendorSectionDefsForCompany(companyId, baseSectionDefs)
        : baseSectionDefs.map((s) => ({ key: s.key, label: s.label }));

    const fieldsBySection = new Map<string, BuiltInFieldConfigurationItem[]>();
    for (const field of registry) {
      const list = fieldsBySection.get(field.sectionKey) ?? [];
      list.push({
        fieldKey: field.fieldKey,
        label: field.label,
        sectionKey: field.sectionKey,
        fieldType: field.fieldType,
        apiKey: getBuiltInApiKey(field),
        visible: resolveBuiltInVisibility(field, overrides.visibility),
        required: field.required,
        configurable: field.configurable,
        source: 'BUILT_IN',
        hasOverride:
          fieldHasOverride(field, overrides.visibility) ||
          fieldHasOverride(field, overrides.registration),
        ...this.registrationState(field, overrides, isRegistrationTab(field.sectionKey)),
      });
      fieldsBySection.set(field.sectionKey, list);
    }

    return sectionDefs
      .filter((section) => fieldsBySection.has(section.key))
      .map((section) => ({
        sectionKey: section.key,
        label: section.label,
        fields: fieldsBySection.get(section.key) ?? [],
      }));
  }
}
