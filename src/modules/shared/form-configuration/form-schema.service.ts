import { Injectable } from '@nestjs/common';
import { serialize } from '@/common/utils/bigint.util';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  CUSTOM_FIELD_MODULES,
  CustomFieldEntityType,
  ITEM_SECTIONS,
  VENDOR_SECTIONS,
} from '../custom-fields/custom-fields.constants';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
import { CustomFieldsValidationService } from '../custom-fields/custom-fields-validation.service';
import { TabAccessService } from '../tab-access/tab-access.service';
import { mapSectionKeyToTabKey } from '../tab-access/tab-registry';
import { getBuiltInFields } from './built-in-field-registry';
import { FormConfigurationService } from './form-configuration.service';
import { resolveVendorSectionDefsForCompany } from './ana-vendor-section-labels';

@Injectable()
export class FormSchemaService {
  constructor(
    private readonly formConfigurationService: FormConfigurationService,
    private readonly customFieldsRepository: CustomFieldsRepository,
    private readonly customFieldsValidationService: CustomFieldsValidationService,
    private readonly tabAccessService: TabAccessService,
  ) {}

  async resolveFormSchema(
    companyId: string,
    entityType: CustomFieldEntityType,
    user?: AuthenticatedUser,
  ) {
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

    const baseSectionDefs =
      CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType)?.sections ??
      (entityType === 'item' ? ITEM_SECTIONS : VENDOR_SECTIONS);
    const sectionDefs =
      entityType === 'vendor'
        ? resolveVendorSectionDefsForCompany(companyId, baseSectionDefs)
        : baseSectionDefs.map((s) => ({ key: s.key, label: s.label }));

    const visibleTabKeys = user
      ? await this.tabAccessService.getVisibleTabKeysForUser({
          companyId,
          entityType,
          user,
        })
      : new Set(
          sectionDefs.map((s) => mapSectionKeyToTabKey(entityType, s.key)),
        );

    const isSectionVisible = (sectionKey: string) =>
      visibleTabKeys.has(mapSectionKeyToTabKey(entityType, sectionKey));

    const visibleSectionDefs = sectionDefs.filter((s) => isSectionVisible(s.key));
    const visibleBuiltInFields = builtInFields.filter((f) => isSectionVisible(f.sectionKey));
    const visibleCustomFields = customFields.filter((f) =>
      isSectionVisible(f.sectionKey ?? 'custom'),
    );

    const resolvedSections = this.buildResolvedSections(
      visibleSectionDefs,
      visibleBuiltInFields,
      visibleCustomFields,
    );

    return serialize({
      entityType,
      /** Legacy: custom field definitions only (unchanged contract). */
      fields: visibleCustomFields.map(
        ({ key, label, source, visible, configurable, ...rest }) => rest,
      ),
      /** Legacy: section tab metadata only — role-filtered at runtime. */
      sections: visibleSectionDefs,
      /** Built-in developer fields with effective company visibility (role-filtered). */
      builtInFields: visibleBuiltInFields.map(({ storage, ...field }) => field),
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

    // Include every visible section (even empty) so FE can render Attachments / markers.
    // Do not leak sections that Tab Access hid.
    return sectionOrder.map((sectionKey) => ({
      sectionKey,
      label: sectionDefs.find((s) => s.key === sectionKey)?.label ?? sectionKey,
      fields: fieldsBySection.get(sectionKey) ?? [],
    }));
  }
}
