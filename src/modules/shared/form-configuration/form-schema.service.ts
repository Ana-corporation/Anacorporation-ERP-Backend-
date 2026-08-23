import { Injectable } from '@nestjs/common';
import { serialize } from '@/common/utils/bigint.util';
import {
  CUSTOM_FIELD_MODULES,
  CustomFieldEntityType,
  ITEM_SECTIONS,
  VENDOR_SECTIONS,
} from '../custom-fields/custom-fields.constants';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
import { CustomFieldsValidationService } from '../custom-fields/custom-fields-validation.service';
import { getBuiltInFields } from './built-in-field-registry';
import { FormConfigurationService } from './form-configuration.service';

@Injectable()
export class FormSchemaService {
  constructor(
    private readonly formConfigurationService: FormConfigurationService,
    private readonly customFieldsRepository: CustomFieldsRepository,
    private readonly customFieldsValidationService: CustomFieldsValidationService,
  ) {}

  async resolveFormSchema(companyId: string, entityType: CustomFieldEntityType) {
    const registry = getBuiltInFields(entityType);
    const overrides = await this.formConfigurationService.loadOverrideMap(companyId, entityType);

    const builtInFields = registry.map((field) =>
      this.formConfigurationService.toBuiltInSchemaField(field, overrides),
    );

    const definitions = await this.customFieldsRepository.findDefinitionsByCompany(
      companyId,
      entityType,
      false,
    );
    const customFields = definitions
      .filter((d) => !d.isHidden)
      .map((def) => ({
        ...this.customFieldsValidationService.toFormSchemaField(def),
        key: def.fieldName,
        label: def.displayName,
        source: 'CUSTOM' as const,
        visible: true,
        configurable: false,
      }));

    const sectionDefs =
      CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType)?.sections ??
      (entityType === 'item' ? ITEM_SECTIONS : VENDOR_SECTIONS);

    const resolvedSections = this.buildResolvedSections(
      sectionDefs,
      builtInFields,
      customFields,
    );

    return serialize({
      entityType,
      /** Legacy: custom field definitions only (unchanged contract). */
      fields: customFields.map(({ key, label, source, visible, configurable, ...rest }) => rest),
      /** Legacy: section tab metadata only (unchanged contract). */
      sections: sectionDefs,
      /** Built-in developer fields with effective company visibility. */
      builtInFields: builtInFields.map(({ storage, ...field }) => field),
      /** Merged built-in + custom fields grouped by section (preferred for Vendor form). */
      resolvedSections,
    });
  }

  private buildResolvedSections(
    sectionDefs: { key: string; label: string }[],
    builtInFields: ReturnType<FormConfigurationService['toBuiltInSchemaField']>[],
    customFields: Array<
      ReturnType<CustomFieldsValidationService['toFormSchemaField']> & {
        key: string;
        label: string;
        source: 'CUSTOM';
        visible: boolean;
        configurable: boolean;
      }
    >,
  ) {
    const sectionOrder = sectionDefs.map((s) => s.key);
    const fieldsBySection = new Map<string, unknown[]>();

    for (const field of builtInFields) {
      if (!field.visible) continue;
      const list = fieldsBySection.get(field.sectionKey) ?? [];
      const { storage, ...publicField } = field;
      list.push(publicField);
      fieldsBySection.set(field.sectionKey, list);
    }
    for (const field of customFields) {
      const sectionKey = field.sectionKey ?? 'custom';
      const list = fieldsBySection.get(sectionKey) ?? [];
      list.push({
        key: field.key,
        label: field.label,
        fieldType: field.fieldType,
        sectionKey,
        source: field.source,
        visible: field.visible,
        required: field.isRequired,
        configurable: field.configurable,
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        displayName: field.displayName,
        defaultValue: field.defaultValue,
        validation: field.validation,
        options: field.options,
        placeholder: field.placeholder,
        helpText: field.helpText,
        sortOrder: field.sortOrder,
        isFilterable: field.isFilterable,
        isReadOnly: field.isReadOnly,
      });
      fieldsBySection.set(sectionKey, list);
    }

    const knownSections = sectionOrder.filter((key) => fieldsBySection.has(key));
    const extraSections = [...fieldsBySection.keys()].filter((key) => !sectionOrder.includes(key));

    return [...knownSections, ...extraSections].map((sectionKey) => ({
      sectionKey,
      label: sectionDefs.find((s) => s.key === sectionKey)?.label ?? sectionKey,
      fields: fieldsBySection.get(sectionKey) ?? [],
    }));
  }
}
