import { HttpStatus, Injectable } from '@nestjs/common';
import { CustomFieldDefinition, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  BusinessException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import {
  CUSTOM_FIELD_MODULES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPES_NOT_IMPLEMENTED,
  CustomFieldEntityType,
  CustomFieldOption,
  CustomFieldType,
  FIELD_NAME_REGEX,
  findReservedDisplayLabel,
  getReservedDisplayLabels,
  getReservedFieldLabel,
  getReservedFieldNames,
  isReservedFieldName,
  resolveRequiredSectionKey,
  slugifyFieldName,
  VENDOR_SECTIONS,
} from './custom-fields.constants';
import {
  CreateCustomFieldDefinitionDto,
  CustomFieldDefinitionsQueryDto,
  UpdateCustomFieldDefinitionDto,
} from './dto/custom-field-definition.dto';
import { CustomFieldsRepository } from './custom-fields.repository';
import {
  assertDropdownHasOptions,
  assertValidationRulesShape,
  CustomFieldsValidationService,
} from './custom-fields-validation.service';

@Injectable()
export class CustomFieldsDefinitionsService {
  constructor(
    private readonly repository: CustomFieldsRepository,
    private readonly validationService: CustomFieldsValidationService,
  ) {}

  listModules() {
    return {
      items: CUSTOM_FIELD_MODULES.map((m) => ({
        entityType: m.entityType,
        label: m.label,
        productModule: m.productModule,
      })),
    };
  }

  listSections(entityType: string) {
    if (!(CUSTOM_FIELD_MODULES as { entityType: string }[]).some((m) => m.entityType === entityType)) {
      throw new BusinessException(`Unsupported entity type: ${entityType}`);
    }
    const mod = CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType)!;
    return {
      entityType,
      sections: mod.sections,
      reservedFieldNames: getReservedFieldNames(entityType as CustomFieldEntityType),
      reservedDisplayNames: getReservedDisplayLabels(entityType as CustomFieldEntityType),
    };
  }

  async findAll(companyId: string, query: CustomFieldDefinitionsQueryDto) {
    const items = await this.repository.findDefinitionsByCompany(
      companyId,
      query.entityType,
      query.includeInactive,
    );
    const mapped = items.map((item) => this.toResponse(item));

    if (query.groupedBySection && query.entityType) {
      return serialize(this.groupBySection(query.entityType, mapped));
    }

    return serialize({ items: mapped, total: mapped.length });
  }

  async findOne(fieldId: string, companyId: string) {
    const item = await this.repository.findDefinitionById(fieldId, companyId);
    if (!item) throw new NotFoundException('Custom field definition');
    return serialize(this.toResponse(item));
  }

  async create(companyId: string, dto: CreateCustomFieldDefinitionDto, actorId: string) {
    this.assertFieldTypeSupported(dto.fieldType);

    const fieldType = dto.fieldType as CustomFieldType;
    const options = dto.options as CustomFieldOption[] | undefined;
    assertDropdownHasOptions(fieldType, options);
    assertValidationRulesShape(dto.validation);

    const entityType = dto.entityType;
    const sectionKey = resolveRequiredSectionKey(entityType, dto.sectionKey);
    if (!sectionKey) {
      throw new BusinessException(
        'sectionKey is required and must be a valid Vendor section',
        HttpStatus.BAD_REQUEST,
        [
          {
            field: 'sectionKey',
            message: 'Required. Use a key from GET .../custom-fields/meta/modules/vendor/sections',
          },
        ],
      );
    }

    const displayName = dto.displayName.trim();
    this.assertNotReservedDisplayName(entityType, displayName);

    const dupLabel = await this.repository.findDefinitionByDisplayName(
      companyId,
      entityType,
      displayName,
    );
    if (dupLabel) {
      throw new BusinessException(
        `Display name "${displayName}" is already used by another custom field.`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'displayName', message: `Display name "${displayName}" must be unique` }],
      );
    }

    const fieldName = (dto.fieldName?.trim() || slugifyFieldName(displayName)).trim();
    if (!FIELD_NAME_REGEX.test(fieldName)) {
      throw new BusinessException(
        'fieldName must start with a letter and use letters, numbers, or underscore',
        HttpStatus.BAD_REQUEST,
        [{ field: 'fieldName', message: 'Invalid fieldName format' }],
      );
    }

    this.assertNotReservedFieldName(entityType, fieldName, displayName);

    const dupName = await this.repository.findDefinitionByName(companyId, entityType, fieldName);
    if (dupName) {
      throw new BusinessException(
        `Field name "${fieldName}" is already used by another custom field.`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'fieldName', message: `Field name "${fieldName}" must be unique` }],
      );
    }

    this.validationService.assertDefaultValue(
      displayName,
      fieldType,
      dto.defaultValue,
      dto.validation,
      options,
    );

    const item = await this.repository.createDefinition(
      companyId,
      {
        entityType,
        fieldName,
        displayName,
        fieldType: dto.fieldType,
        sectionKey,
        isRequired: dto.isRequired,
        defaultValue: dto.defaultValue,
        validation: dto.validation,
        options: dto.options,
        sortOrder: dto.sortOrder,
        placeholder: dto.placeholder,
        helpText: dto.helpText,
        description: dto.description,
        isActive: dto.isActive,
        isReadOnly: dto.isReadOnly,
        isHidden: dto.isHidden,
        isSearchable: dto.isSearchable,
        isFilterable: dto.isFilterable,
        isSortable: dto.isSortable,
        isExportable: dto.isExportable,
        isPrintable: dto.isPrintable,
      },
      actorId,
    );

    return serialize(this.toResponse(item));
  }

  async update(
    fieldId: string,
    companyId: string,
    dto: UpdateCustomFieldDefinitionDto,
    actorId: string,
  ) {
    const existing = await this.repository.findDefinitionById(fieldId, companyId);
    if (!existing) throw new NotFoundException('Custom field definition');

    if (dto.fieldType !== undefined) {
      this.assertFieldTypeSupported(dto.fieldType);
    }

    const entityType = existing.entityType as CustomFieldEntityType;
    const fieldType = (dto.fieldType ?? existing.fieldType) as CustomFieldType;
    const options =
      dto.options !== undefined
        ? (dto.options as CustomFieldOption[] | null)
        : (existing.options as unknown as CustomFieldOption[] | null);
    assertDropdownHasOptions(fieldType, options ?? undefined);

    if (dto.validation !== undefined) {
      assertValidationRulesShape(dto.validation);
    }

    let sectionKey: string | undefined;
    if (dto.sectionKey !== undefined) {
      if (dto.sectionKey === null || !String(dto.sectionKey).trim()) {
        throw new BusinessException('sectionKey cannot be empty', HttpStatus.BAD_REQUEST, [
          { field: 'sectionKey', message: 'sectionKey is required' },
        ]);
      }
      const resolved = resolveRequiredSectionKey(entityType, dto.sectionKey);
      if (!resolved) {
        throw new BusinessException(
          'sectionKey must be a valid Vendor section',
          HttpStatus.BAD_REQUEST,
          [{ field: 'sectionKey', message: 'Invalid sectionKey' }],
        );
      }
      sectionKey = resolved;
    }

    const displayName =
      dto.displayName !== undefined ? dto.displayName.trim() : existing.displayName;

    if (dto.displayName !== undefined) {
      this.assertNotReservedDisplayName(entityType, displayName);

      const dupLabel = await this.repository.findDefinitionByDisplayName(
        companyId,
        entityType,
        displayName,
      );
      if (dupLabel && dupLabel.fieldId !== existing.fieldId) {
        throw new BusinessException(
          `Display name "${displayName}" is already used by another custom field.`,
          HttpStatus.BAD_REQUEST,
          [{ field: 'displayName', message: `Display name "${displayName}" must be unique` }],
        );
      }
    }

    const validation =
      dto.validation !== undefined ? dto.validation : existing.validation;
    const defaultValue =
      dto.defaultValue !== undefined ? dto.defaultValue : existing.defaultValue;

    this.validationService.assertDefaultValue(
      displayName,
      fieldType,
      defaultValue,
      validation,
      options,
    );

    const item = await this.repository.updateDefinition(
      fieldId,
      dto,
      actorId,
      sectionKey,
    );
    return serialize(this.toResponse(item));
  }

  /**
   * Soft-delete: deactivate definition only.
   * Never deletes custom_field_values — historical Vendor data is retained.
   */
  async remove(fieldId: string, companyId: string, actorId: string) {
    const existing = await this.repository.findDefinitionById(fieldId, companyId);
    if (!existing) throw new NotFoundException('Custom field definition');

    await this.repository.softDeleteDefinition(fieldId, actorId);
    return {
      message:
        'Custom field deactivated. Existing Vendor values are retained and will not appear on new create/edit forms.',
    };
  }

  async getFormSchema(companyId: string, entityType: CustomFieldEntityType) {
    const definitions = await this.repository.findDefinitionsByCompany(
      companyId,
      entityType,
      false,
    );
    const visible = definitions.filter((d) => !d.isHidden);
    return serialize({
      entityType,
      fields: visible.map((def) => this.validationService.toFormSchemaField(def)),
      sections: entityType === 'vendor' ? VENDOR_SECTIONS : [],
    });
  }

  private assertFieldTypeSupported(fieldType: string) {
    if ((CUSTOM_FIELD_TYPES_NOT_IMPLEMENTED as readonly string[]).includes(fieldType)) {
      throw new BusinessException(
        `Field type '${fieldType}' is not implemented yet`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'fieldType', message: `Field type '${fieldType}' is not implemented yet` }],
      );
    }
    if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(fieldType)) {
      throw new BusinessException(`Unsupported field type '${fieldType}'`, HttpStatus.BAD_REQUEST, [
        { field: 'fieldType', message: `Unsupported field type '${fieldType}'` },
      ]);
    }
  }

  private assertNotReservedDisplayName(entityType: CustomFieldEntityType, displayName: string) {
    const label = findReservedDisplayLabel(entityType, displayName);
    if (label) {
      throw new BusinessException(
        `${label} is already a standard Vendor field.`,
        HttpStatus.BAD_REQUEST,
        [{ field: 'displayName', message: `${label} is already a standard Vendor field.` }],
      );
    }
  }

  private assertNotReservedFieldName(
    entityType: CustomFieldEntityType,
    fieldName: string,
    displayName: string,
  ) {
    if (!isReservedFieldName(entityType, fieldName)) return;
    const label = getReservedFieldLabel(entityType, fieldName);
    throw new BusinessException(
      `${label} is already a standard Vendor field.`,
      HttpStatus.BAD_REQUEST,
      [
        {
          field: 'fieldName',
          message: `Cannot use "${fieldName}" (from "${displayName}") — reserved for standard Vendor field "${label}".`,
        },
      ],
    );
  }

  private groupBySection(entityType: CustomFieldEntityType, fields: ReturnType<CustomFieldsDefinitionsService['toResponse']>[]) {
    const mod = CUSTOM_FIELD_MODULES.find((m) => m.entityType === entityType);
    const sections = (mod?.sections ?? [{ key: 'custom', label: 'Custom' }]).map((s) => ({
      sectionKey: s.key,
      label: s.label,
      fields: fields.filter((f) => (f.sectionKey || 'custom') === s.key),
    }));
    return { entityType, sections };
  }

  private toResponse(item: CustomFieldDefinition) {
    return {
      fieldId: item.fieldId.toString(),
      companyId: item.companyId.toString(),
      entityType: item.entityType,
      sectionKey: item.sectionKey ?? 'custom',
      fieldName: item.fieldName,
      displayName: item.displayName,
      fieldType: item.fieldType,
      isRequired: item.isRequired,
      defaultValue: item.defaultValue ?? null,
      validation: item.validation ?? null,
      options: item.options ?? null,
      placeholder: item.placeholder ?? null,
      helpText: item.helpText ?? null,
      description: item.description ?? null,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      isReadOnly: item.isReadOnly,
      isHidden: item.isHidden,
      isSearchable: item.isSearchable,
      isFilterable: item.isFilterable,
      isSortable: item.isSortable,
      isExportable: item.isExportable,
      isPrintable: item.isPrintable,
      createdBy: item.createdBy?.toString() ?? null,
      updatedBy: item.updatedBy?.toString() ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}

@Injectable()
export class CustomFieldsValuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: CustomFieldsRepository,
    private readonly validationService: CustomFieldsValidationService,
  ) {}

  async loadCustomFieldsMap(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordId: string,
  ): Promise<Record<string, unknown>> {
    const [definitions, values] = await Promise.all([
      this.repository.findDefinitionsByCompany(companyId, entityType, false),
      this.repository.findValuesForRecord(companyId, entityType, recordId),
    ]);

    return this.validationService.buildApiMapFromRows(
      definitions,
      values.map((v) => ({
        field: v.field,
        valueText: v.valueText,
        valueNumber: v.valueNumber,
        valueDate: v.valueDate,
        valueBool: v.valueBool,
        valueJson: v.valueJson,
      })),
    );
  }

  async loadCustomFieldsMapsForRecords(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordIds: bigint[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const result = new Map<string, Record<string, unknown>>();
    if (recordIds.length === 0) return result;

    const [definitions, values] = await Promise.all([
      this.repository.findDefinitionsByCompany(companyId, entityType, false),
      this.repository.findValuesForRecords(companyId, entityType, recordIds),
    ]);

    const byRecord = new Map<string, typeof values>();
    for (const row of values) {
      const key = row.recordId.toString();
      const list = byRecord.get(key) ?? [];
      list.push(row);
      byRecord.set(key, list);
    }

    for (const id of recordIds) {
      const key = id.toString();
      const rows = byRecord.get(key) ?? [];
      result.set(
        key,
        this.validationService.buildApiMapFromRows(
          definitions,
          rows.map((v) => ({
            field: v.field,
            valueText: v.valueText,
            valueNumber: v.valueNumber,
            valueDate: v.valueDate,
            valueBool: v.valueBool,
            valueJson: v.valueJson,
          })),
        ),
      );
    }
    return result;
  }

  async persistCustomFields(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordId: string,
    customFields: Record<string, unknown> | undefined,
    mode: 'create' | 'update',
    tx?: Prisma.TransactionClient,
  ): Promise<Record<string, unknown>> {
    const definitions = await this.repository.findDefinitionsByCompany(
      companyId,
      entityType,
      false,
    );

    const validated = this.validationService.validateAndNormalize(
      definitions,
      customFields,
      mode,
    );

    if (validated.values.size === 0 && validated.clearFieldIds.length === 0) {
      return validated.apiMap;
    }

    const run = async (client: Prisma.TransactionClient) => {
      if (validated.clearFieldIds.length > 0) {
        await this.repository.deleteValuesByFieldIds(
          companyId,
          entityType,
          recordId,
          validated.clearFieldIds,
          client,
        );
      }
      for (const entry of validated.values.values()) {
        await this.repository.upsertValue(
          companyId,
          entityType,
          recordId,
          entry.fieldId,
          entry.columns,
          client,
        );
      }
    };

    if (tx) {
      await run(tx);
    } else {
      await this.prisma.$transaction(async (client) => {
        await run(client as Prisma.TransactionClient);
      });
    }

    return validated.apiMap;
  }

  async mergeEntityWithCustomFields<T extends Record<string, unknown>>(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordId: string,
    entity: T,
  ) {
    const customFields = await this.loadCustomFieldsMap(companyId, entityType, recordId);
    return { ...entity, customFields };
  }

  /** Filter vendor/record IDs by cf.fieldName=value (filterable defs only). */
  async filterRecordIdsByCustomFields(
    companyId: string,
    entityType: CustomFieldEntityType,
    cfFilters: Record<string, string>,
  ): Promise<bigint[] | null> {
    const entries = Object.entries(cfFilters);
    if (entries.length === 0) return null;

    const definitions: CustomFieldDefinition[] = await this.repository.findDefinitionsByCompany(
      companyId,
      entityType,
      false,
    );
    const filterable = new Map<string, CustomFieldDefinition>(
      definitions.filter((d) => d.isFilterable).map((d) => [d.fieldName, d]),
    );

    let allowed: Set<string> | null = null;

    for (const [fieldName, rawValue] of entries) {
      const def = filterable.get(fieldName);
      if (!def) {
        throw new BusinessException(
          `Custom field '${fieldName}' is not filterable`,
          HttpStatus.BAD_REQUEST,
          [{ field: `cf.${fieldName}`, message: `Custom field '${fieldName}' is not filterable` }],
        );
      }

      const rows = await this.repository.findRecordIdsMatchingFieldValue(
        companyId,
        entityType,
        def,
        rawValue,
      );

      const ids = new Set(rows.map((r) => r.recordId.toString()));
      allowed = allowed === null ? ids : new Set([...allowed].filter((id) => ids.has(id)));
    }

    return [...(allowed ?? [])].map((id) => BigInt(id));
  }
}
