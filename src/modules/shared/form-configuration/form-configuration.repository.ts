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

  /** Drops the show/hide flags; a saved field order on the same row stays. */
  async clearVisibilityOverride(
    companyId: string,
    entityType: CustomFieldEntityType,
    fieldKey: string,
  ) {
    const where = { companyId: parseBigIntId(companyId), entityType, fieldKey };
    await this.prisma.companyFieldConfiguration.deleteMany({
      where: { ...where, displayOrder: null },
    });
    await this.prisma.companyFieldConfiguration.updateMany({
      where: { ...where, displayOrder: { not: null } },
      data: { isVisible: null, isRegistrationVisible: null },
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
