import { Injectable } from '@nestjs/common';
import { CustomFieldDefinition, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { CustomFieldEntityType } from './custom-fields.constants';
import { UpdateCustomFieldDefinitionDto } from './dto/custom-field-definition.dto';

export type CustomFieldValueColumns = {
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueDate: Date | null;
  valueBool: boolean | null;
  valueJson: Prisma.InputJsonValue | null;
};

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class CustomFieldsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(client?: DbClient): Prisma.TransactionClient {
    return (client ?? this.prisma) as unknown as Prisma.TransactionClient;
  }

  findDefinitionsByCompany(
    companyId: string,
    entityType?: CustomFieldEntityType,
    includeInactive = false,
  ) {
    return this.prisma.customFieldDefinition.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        ...(entityType ? { entityType } : {}),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { fieldName: 'asc' }],
    });
  }

  findDefinitionById(fieldId: string, companyId: string) {
    return this.prisma.customFieldDefinition.findFirst({
      where: {
        fieldId: parseBigIntId(fieldId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  findDefinitionByName(companyId: string, entityType: string, fieldName: string) {
    return this.prisma.customFieldDefinition.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        fieldName,
        deletedAt: null,
      },
    });
  }

  findDefinitionByDisplayName(companyId: string, entityType: string, displayName: string) {
    return this.prisma.customFieldDefinition.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        displayName: { equals: displayName.trim(), mode: 'insensitive' },
        deletedAt: null,
      },
    });
  }

  findFieldNamesWithPrefix(companyId: string, entityType: string, prefix: string) {
    return this.prisma.customFieldDefinition.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        fieldName: { startsWith: prefix },
        deletedAt: null,
      },
      select: { fieldName: true },
    });
  }

  createDefinition(
    companyId: string,
    data: {
      entityType: string;
      fieldName: string;
      displayName: string;
      fieldType: string;
      sectionKey: string;
      isRequired?: boolean;
      defaultValue?: unknown;
      validation?: unknown;
      options?: unknown;
      sortOrder?: number;
      placeholder?: string | null;
      helpText?: string | null;
      description?: string | null;
      isActive?: boolean;
      isReadOnly?: boolean;
      isHidden?: boolean;
      isSearchable?: boolean;
      isFilterable?: boolean;
      isSortable?: boolean;
      isExportable?: boolean;
      isPrintable?: boolean;
    },
    createdBy?: string,
  ) {
    return this.prisma.customFieldDefinition.create({
      data: {
        companyId: parseBigIntId(companyId),
        entityType: data.entityType,
        fieldName: data.fieldName,
        displayName: data.displayName.trim(),
        fieldType: data.fieldType,
        sectionKey: data.sectionKey,
        isRequired: data.isRequired ?? false,
        defaultValue: data.defaultValue as Prisma.InputJsonValue | undefined,
        validation: data.validation as Prisma.InputJsonValue | undefined,
        options: data.options as Prisma.InputJsonValue | undefined,
        sortOrder: data.sortOrder ?? 0,
        placeholder: data.placeholder ?? null,
        helpText: data.helpText ?? null,
        description: data.description ?? null,
        isActive: data.isActive ?? true,
        isReadOnly: data.isReadOnly ?? false,
        isHidden: data.isHidden ?? false,
        isSearchable: data.isSearchable ?? false,
        isFilterable: data.isFilterable ?? false,
        isSortable: data.isSortable ?? false,
        isExportable: data.isExportable ?? true,
        isPrintable: data.isPrintable ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  updateDefinition(
    fieldId: string,
    dto: UpdateCustomFieldDefinitionDto,
    updatedBy?: string,
    sectionKey?: string | null,
  ) {
    const data = {
      ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
      ...(dto.fieldType !== undefined ? { fieldType: dto.fieldType } : {}),
      ...(sectionKey !== undefined ? { sectionKey } : {}),
      ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
      ...(dto.defaultValue !== undefined
        ? { defaultValue: dto.defaultValue as Prisma.InputJsonValue | null }
        : {}),
      ...(dto.validation !== undefined
        ? { validation: dto.validation as Prisma.InputJsonValue | null }
        : {}),
      ...(dto.options !== undefined
        ? { options: dto.options as Prisma.InputJsonValue | null }
        : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.placeholder !== undefined ? { placeholder: dto.placeholder } : {}),
      ...(dto.helpText !== undefined ? { helpText: dto.helpText } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.isReadOnly !== undefined ? { isReadOnly: dto.isReadOnly } : {}),
      ...(dto.isHidden !== undefined ? { isHidden: dto.isHidden } : {}),
      ...(dto.isSearchable !== undefined ? { isSearchable: dto.isSearchable } : {}),
      ...(dto.isFilterable !== undefined ? { isFilterable: dto.isFilterable } : {}),
      ...(dto.isSortable !== undefined ? { isSortable: dto.isSortable } : {}),
      ...(dto.isExportable !== undefined ? { isExportable: dto.isExportable } : {}),
      ...(dto.isPrintable !== undefined ? { isPrintable: dto.isPrintable } : {}),
      updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
      updatedAt: new Date(),
    } as Prisma.CustomFieldDefinitionUncheckedUpdateInput;

    return this.prisma.customFieldDefinition.update({
      where: { fieldId: parseBigIntId(fieldId) },
      data,
    });
  }

  softDeleteDefinition(fieldId: string, deletedBy?: string) {
    return this.prisma.customFieldDefinition.update({
      where: { fieldId: parseBigIntId(fieldId) },
      data: {
        isActive: false,
        deletedAt: new Date(),
        updatedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  findValuesForRecord(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordId: string,
  ) {
    return this.prisma.customFieldValue.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        recordId: parseBigIntId(recordId),
      },
      include: { field: true },
    });
  }

  findValuesForRecords(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordIds: bigint[],
  ) {
    if (recordIds.length === 0) return Promise.resolve([]);
    return this.prisma.customFieldValue.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        recordId: { in: recordIds },
      },
      include: { field: true },
    });
  }

  upsertValue(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordId: string,
    fieldId: bigint,
    columns: CustomFieldValueColumns,
    client?: DbClient,
  ) {
    const db = this.db(client);
    const createData = {
      companyId: parseBigIntId(companyId),
      entityType,
      recordId: parseBigIntId(recordId),
      fieldId,
      valueText: columns.valueText,
      valueNumber: columns.valueNumber,
      valueDate: columns.valueDate,
      valueBool: columns.valueBool,
      valueJson: columns.valueJson ?? undefined,
    };
    const updateData = {
      valueText: columns.valueText,
      valueNumber: columns.valueNumber,
      valueDate: columns.valueDate,
      valueBool: columns.valueBool,
      valueJson: columns.valueJson ?? undefined,
      updatedAt: new Date(),
    };

    return db.customFieldValue.upsert({
      where: {
        fieldId_recordId: {
          fieldId,
          recordId: parseBigIntId(recordId),
        },
      },
      create: createData as Prisma.CustomFieldValueUncheckedCreateInput,
      update: updateData as Prisma.CustomFieldValueUncheckedUpdateInput,
    });
  }

  deleteValuesForRecordExceptFields(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordId: string,
    keepFieldIds: bigint[],
    client?: DbClient,
  ) {
    return this.db(client).customFieldValue.deleteMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        recordId: parseBigIntId(recordId),
        ...(keepFieldIds.length > 0 ? { fieldId: { notIn: keepFieldIds } } : {}),
      },
    });
  }

  deleteValuesByFieldIds(
    companyId: string,
    entityType: CustomFieldEntityType,
    recordId: string,
    fieldIds: bigint[],
    client?: DbClient,
  ) {
    if (fieldIds.length === 0) return Promise.resolve({ count: 0 });
    return this.db(client).customFieldValue.deleteMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        recordId: parseBigIntId(recordId),
        fieldId: { in: fieldIds },
      },
    });
  }
}
