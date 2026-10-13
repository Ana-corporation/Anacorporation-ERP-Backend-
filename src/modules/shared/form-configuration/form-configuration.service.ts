import { HttpStatus, Injectable } from '@nestjs/common';
import { CustomFieldDefinition, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { BusinessException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import {
  CUSTOM_FIELD_MODULES,
  CustomFieldEntityType,
  ITEM_SECTIONS,
  VENDOR_SECTIONS,
} from '../custom-fields/custom-fields.constants';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
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
  resolveCustomRegistrationVisibility,
  fieldHasOverride,
} from './built-in-field-registry';
import { UpdateFieldOrderDto, UpdateFormConfigurationDto } from './dto/form-configuration.dto';
import {
  computeDisplayOrders,
  customFieldSectionKey,
  fieldOrderKey,
} from './field-order.util';
import { FormConfigurationRepository } from './form-configuration.repository';
import { resolveVendorSectionDefsForCompany } from './ana-vendor-section-labels';
import { TabAccessService } from '../tab-access/tab-access.service';

export interface FormConfigurationFieldItem {
  fieldKey: string;
  label: string;
  sectionKey: string;
  fieldType: string;
  apiKey: string;
  visible: boolean;
  required: boolean;
  configurable: boolean;
  source: 'BUILT_IN' | 'CUSTOM';
  hasOverride: boolean;
  registrationVisible: boolean;
  registrationConfigurable: boolean;
  displayOrder: number;
  fieldId?: string;
}

export interface FieldOverrideMaps {
  visibility: Map<string, boolean>;
  registration: Map<string, boolean>;
  order: Map<string, number>;
}

export interface FormConfigurationSection {
  sectionKey: string;
  label: string;
  fields: FormConfigurationFieldItem[];
}

export const FORM_CONFIG_ORDER_ERROR_CODES = {
  INVALID_SECTION: 'FORM_CONFIG_INVALID_SECTION',
  INVALID_FIELD: 'FORM_CONFIG_INVALID_FIELD',
  DUPLICATE_ORDER: 'FORM_CONFIG_DUPLICATE_ORDER',
  INCOMPLETE_SECTION: 'FORM_CONFIG_INCOMPLETE_SECTION',
} as const;

@Injectable()
export class FormConfigurationService {
  constructor(
    private readonly repository: FormConfigurationRepository,
    private readonly tabAccessService: TabAccessService,
    private readonly customFieldsRepository: CustomFieldsRepository,
    private readonly auditService: AuditService,
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
    const [overrides, customDefs, isRegistrationTab] = await Promise.all([
      this.loadFieldOverrides(companyId, resolvedEntity),
      this.customFieldsRepository.findDefinitionsByCompany(companyId, resolvedEntity, false),
      this.tabAccessService.getRegistrationSectionFilter(companyId, resolvedEntity),
    ]);
    const sections = this.groupConfiguration(
      companyId,
      resolvedEntity,
      overrides,
      customDefs,
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
    const customNames = new Set(
      (
        await this.customFieldsRepository.findDefinitionsByCompany(companyId, resolvedEntity, true)
      ).map((def) => def.fieldName),
    );

    for (const row of dto.fields) {
      const field = getBuiltInField(resolvedEntity, row.fieldKey);
      if (!field) {
        // Custom fields are shown/hidden on the custom field itself (GET lists them for ordering).
        if (customNames.has(row.fieldKey)) continue;
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
        await this.repository.clearVisibilityOverride(companyId, resolvedEntity, field.fieldKey);
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

  /** Each listed section must be a full permutation of its built-in + custom fields. */
  async updateFieldOrder(
    companyId: string,
    entityType: string,
    dto: UpdateFieldOrderDto,
    actorId: string,
  ) {
    const resolvedEntity = this.assertSupportedEntity(entityType);
    const sectionKeys = new Set(this.sectionDefsFor(companyId, resolvedEntity).map((s) => s.key));
    const registry = getBuiltInFields(resolvedEntity);
    const customDefs = await this.customFieldsRepository.findDefinitionsByCompany(
      companyId,
      resolvedEntity,
      false,
    );

    const builtInWrites: Array<{ fieldKey: string; displayOrder: number }> = [];
    const customWrites: Array<{ fieldId: bigint; sortOrder: number }> = [];
    const seenSections = new Set<string>();

    dto.sections.forEach((section, sectionIndex) => {
      const path = `sections[${sectionIndex}]`;
      if (!sectionKeys.has(section.sectionKey) || seenSections.has(section.sectionKey)) {
        this.throwOrderError(
          FORM_CONFIG_ORDER_ERROR_CODES.INVALID_SECTION,
          seenSections.has(section.sectionKey)
            ? `Section ${section.sectionKey} is listed more than once`
            : `Unknown section for ${resolvedEntity}: ${section.sectionKey}`,
          `${path}.sectionKey`,
        );
      }
      seenSections.add(section.sectionKey);

      const builtIns = new Set(
        registry.filter((f) => f.sectionKey === section.sectionKey).map((f) => f.fieldKey),
      );
      const customs = new Map(
        customDefs
          .filter((def) => customFieldSectionKey(def) === section.sectionKey)
          .map((def) => [def.fieldName, def]),
      );
      const seenFields = new Set<string>();
      const seenOrders = new Set<number>();

      section.fields.forEach((row, fieldIndex) => {
        const fieldPath = `${path}.fields[${fieldIndex}]`;
        const id = fieldOrderKey(row.source, row.fieldKey);
        const custom = customs.get(row.fieldKey);
        const known = row.source === 'BUILT_IN' ? builtIns.has(row.fieldKey) : Boolean(custom);
        if (!known || seenFields.has(id)) {
          this.throwOrderError(
            FORM_CONFIG_ORDER_ERROR_CODES.INVALID_FIELD,
            known
              ? `${row.fieldKey} is listed more than once in ${section.sectionKey}`
              : `${row.fieldKey} is not a ${row.source === 'BUILT_IN' ? 'built-in' : 'custom'} field of ${section.sectionKey}`,
            `${fieldPath}.fieldKey`,
          );
        }
        if (seenOrders.has(row.displayOrder)) {
          this.throwOrderError(
            FORM_CONFIG_ORDER_ERROR_CODES.DUPLICATE_ORDER,
            `displayOrder ${row.displayOrder} is used twice in ${section.sectionKey}`,
            `${fieldPath}.displayOrder`,
          );
        }
        seenFields.add(id);
        seenOrders.add(row.displayOrder);

        if (custom) customWrites.push({ fieldId: custom.fieldId, sortOrder: row.displayOrder });
        else builtInWrites.push({ fieldKey: row.fieldKey, displayOrder: row.displayOrder });
      });

      const missing = [
        ...[...builtIns].filter((key) => !seenFields.has(fieldOrderKey('BUILT_IN', key))),
        ...[...customs.keys()].filter((key) => !seenFields.has(fieldOrderKey('CUSTOM', key))),
      ];
      if (missing.length > 0) {
        this.throwOrderError(
          FORM_CONFIG_ORDER_ERROR_CODES.INCOMPLETE_SECTION,
          `Section ${section.sectionKey} is missing: ${missing.join(', ')}`,
          `${path}.fields`,
        );
      }
    });

    await this.repository.saveFieldOrder(companyId, resolvedEntity, builtInWrites, customWrites);
    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'FormFieldOrder',
      newValue: { entityType: resolvedEntity, sections: dto.sections },
    });

    return this.getConfiguration(companyId, resolvedEntity);
  }

  /** Clears visibility and built-in order; custom fields keep their sort_order. */
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
    const order = new Map<string, number>();
    for (const row of rows) {
      if (typeof row.isVisible === 'boolean') visibility.set(row.fieldKey, row.isVisible);
      if (typeof row.isRegistrationVisible === 'boolean') {
        registration.set(row.fieldKey, row.isRegistrationVisible);
      }
      if (typeof row.displayOrder === 'number') order.set(row.fieldKey, row.displayOrder);
    }
    return { visibility, registration, order };
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

  sectionDefsFor(companyId: string, entityType: CustomFieldEntityType) {
    const baseSectionDefs =
      CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType)?.sections ??
      (entityType === 'item' ? ITEM_SECTIONS : VENDOR_SECTIONS);
    return entityType === 'vendor'
      ? resolveVendorSectionDefsForCompany(companyId, baseSectionDefs)
      : baseSectionDefs.map((s) => ({ key: s.key, label: s.label }));
  }

  private groupConfiguration(
    companyId: string,
    entityType: CustomFieldEntityType,
    overrides: FieldOverrideMaps,
    customDefs: CustomFieldDefinition[],
    isRegistrationTab: (sectionKey: string) => boolean,
  ): FormConfigurationSection[] {
    const registry = getBuiltInFields(entityType);
    const orders = computeDisplayOrders({
      builtIns: registry,
      customs: customDefs,
      savedBuiltInOrder: overrides.order,
    });

    const items: FormConfigurationFieldItem[] = [
      ...registry.map((field) => ({
        fieldKey: field.fieldKey,
        label: field.label,
        sectionKey: field.sectionKey,
        fieldType: field.fieldType,
        apiKey: getBuiltInApiKey(field),
        visible: resolveBuiltInVisibility(field, overrides.visibility),
        required: field.required,
        configurable: field.configurable,
        source: 'BUILT_IN' as const,
        hasOverride:
          fieldHasOverride(field, overrides.visibility) ||
          fieldHasOverride(field, overrides.registration),
        ...this.registrationState(field, overrides, isRegistrationTab(field.sectionKey)),
        displayOrder: orders.get(fieldOrderKey('BUILT_IN', field.fieldKey)) ?? 0,
      })),
      ...customDefs.map((def) => {
        const sectionKey = customFieldSectionKey(def);
        const tabOn = isRegistrationTab(sectionKey);
        return {
          fieldKey: def.fieldName,
          label: def.displayName,
          sectionKey,
          fieldType: def.fieldType,
          apiKey: def.fieldName,
          visible: !def.isHidden,
          required: def.isRequired,
          configurable: false,
          source: 'CUSTOM' as const,
          hasOverride: false,
          registrationVisible: tabOn && resolveCustomRegistrationVisibility(def),
          registrationConfigurable: tabOn && !def.isHidden,
          displayOrder: orders.get(fieldOrderKey('CUSTOM', def.fieldName)) ?? 0,
          fieldId: def.fieldId.toString(),
        };
      }),
    ];

    const fieldsBySection = new Map<string, FormConfigurationFieldItem[]>();
    for (const item of items) {
      const list = fieldsBySection.get(item.sectionKey) ?? [];
      list.push(item);
      fieldsBySection.set(item.sectionKey, list);
    }

    return this.sectionDefsFor(companyId, entityType)
      .filter((section) => fieldsBySection.has(section.key))
      .map((section) => ({
        sectionKey: section.key,
        label: section.label,
        fields: (fieldsBySection.get(section.key) ?? []).sort(
          (a, b) => a.displayOrder - b.displayOrder,
        ),
      }));
  }

  private throwOrderError(code: string, message: string, field: string): never {
    throw new BusinessException(message, HttpStatus.BAD_REQUEST, [{ field, message }], code);
  }
}
