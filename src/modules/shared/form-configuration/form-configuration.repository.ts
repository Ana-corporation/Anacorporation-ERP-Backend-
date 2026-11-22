import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { CustomFieldEntityType } from '../custom-fields/custom-fields.constants';

@Injectable()
export class FormConfigurationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOverrides(companyId: string, entityType: CustomFieldEntityType) {
    return this.prisma.companyFieldConfiguration.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
      },
    });
  }

  upsertOverride(
    companyId: string,
    entityType: CustomFieldEntityType,
    fieldKey: string,
    values: { isVisible: boolean | null; isRegistrationVisible: boolean | null },
  ) {
    return this.prisma.companyFieldConfiguration.upsert({
      where: {
        companyId_entityType_fieldKey: {
          companyId: parseBigIntId(companyId),
          entityType,
          fieldKey,
        },
      },
      update: values,
      create: {
        companyId: parseBigIntId(companyId),
        entityType,
        fieldKey,
        ...values,
      },
    });
  }

  /** Drops the show/hide flags; a saved order / mandatory flag / label on the same row stays. */
  async clearVisibilityOverride(
    companyId: string,
    entityType: CustomFieldEntityType,
    fieldKey: string,
  ) {
    const where = { companyId: parseBigIntId(companyId), entityType, fieldKey };
    await this.prisma.companyFieldConfiguration.deleteMany({
      where: { ...where, displayOrder: null, isRequired: null, label: null },
    });
    await this.prisma.companyFieldConfiguration.updateMany({
      where,
      data: { isVisible: null, isRegistrationVisible: null },
    });
  }

  /** Mandatory flag + label (null = no override). An empty row is removed. */
  async saveFieldSettings(
    companyId: string,
    entityType: CustomFieldEntityType,
    fieldKey: string,
    values: { isRequired: boolean | null; label: string | null },
  ) {
    const company = parseBigIntId(companyId);
    await this.prisma.companyFieldConfiguration.upsert({
      where: { companyId_entityType_fieldKey: { companyId: company, entityType, fieldKey } },
      update: values,
      create: { companyId: company, entityType, fieldKey, ...values },
    });
    await this.prisma.companyFieldConfiguration.deleteMany({
      where: {
        companyId: company,
        entityType,
        fieldKey,
        isVisible: null,
        isRegistrationVisible: null,
        displayOrder: null,
        isRequired: null,
        label: null,
      },
    });
  }

  /** Built-in display_order upserts and custom sort_order updates in one transaction. */
  saveFieldOrder(
    companyId: string,
    entityType: CustomFieldEntityType,
    builtIns: Array<{ fieldKey: string; displayOrder: number }>,
    customs: Array<{ fieldId: bigint; sortOrder: number }>,
  ) {
    const company = parseBigIntId(companyId);
    return this.prisma.$transaction(async (tx) => {
      for (const { fieldKey, displayOrder } of builtIns) {
        await tx.companyFieldConfiguration.upsert({
          where: { companyId_entityType_fieldKey: { companyId: company, entityType, fieldKey } },
          update: { displayOrder },
          create: { companyId: company, entityType, fieldKey, displayOrder },
        });
      }
      for (const { fieldId, sortOrder } of customs) {
        await tx.customFieldDefinition.updateMany({
          where: { fieldId, companyId: company, entityType, deletedAt: null },
          data: { sortOrder },
        });
      }
    });
  }

  deleteOverride(companyId: string, entityType: CustomFieldEntityType, fieldKey: string) {
    return this.prisma.companyFieldConfiguration.deleteMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
        fieldKey,
      },
    });
  }

  deleteAllOverrides(companyId: string, entityType: CustomFieldEntityType) {
    return this.prisma.companyFieldConfiguration.deleteMany({
      where: {
        companyId: parseBigIntId(companyId),
        entityType,
      },
    });
  }
}
