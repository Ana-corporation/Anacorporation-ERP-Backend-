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
    isVisible: boolean,
  ) {
    return this.prisma.companyFieldConfiguration.upsert({
      where: {
        companyId_entityType_fieldKey: {
          companyId: parseBigIntId(companyId),
          entityType,
          fieldKey,
        },
      },
      update: { isVisible },
      create: {
        companyId: parseBigIntId(companyId),
        entityType,
        fieldKey,
        isVisible,
      },
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
