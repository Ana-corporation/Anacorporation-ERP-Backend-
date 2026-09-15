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
  isSupportedFormConfigurationEntity,
  resolveBuiltInVisibility,
  fieldHasOverride,
} from './built-in-field-registry';
import { UpdateFormConfigurationDto } from './dto/form-configuration.dto';
import { FormConfigurationRepository } from './form-configuration.repository';
import { resolveVendorSectionDefsForCompany } from './ana-vendor-section-labels';

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
}

export interface FormConfigurationSection {
  sectionKey: string;
  label: string;
  fields: BuiltInFieldConfigurationItem[];
}

@Injectable()
export class FormConfigurationService {
  constructor(private readonly repository: FormConfigurationRepository) {}

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
    const overrides = await this.loadOverrideMap(companyId, resolvedEntity);
    const sections = this.groupBuiltInConfiguration(
      companyId,
      resolvedEntity,
      registry,
      overrides,
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

      if (!field.configurable) {
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

      if (row.isVisible === field.defaultVisible) {
        await this.repository.deleteOverride(companyId, resolvedEntity, field.fieldKey);
      } else {
        await this.repository.upsertOverride(
          companyId,
          resolvedEntity,
          field.fieldKey,
          row.isVisible,
        );
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

  async loadOverrideMap(companyId: string, entityType: CustomFieldEntityType) {
    const rows = await this.repository.findOverrides(companyId, entityType);
    return new Map(rows.map((row) => [row.fieldKey, row.isVisible]));
  }

  toBuiltInSchemaField(
    field: BuiltInFieldDefinition,
    overrides: Map<string, boolean>,
  ) {
    const visible = resolveBuiltInVisibility(field, overrides);
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
      storage: field.storage,
    };
  }

  groupBuiltInConfiguration(
    companyId: string,
    entityType: CustomFieldEntityType,
    registry: BuiltInFieldDefinition[],
    overrides: Map<string, boolean>,
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
        visible: resolveBuiltInVisibility(field, overrides),
        required: field.required,
        configurable: field.configurable,
        source: 'BUILT_IN',
        hasOverride: fieldHasOverride(field, overrides),
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
