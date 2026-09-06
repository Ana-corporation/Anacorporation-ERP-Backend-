import { Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId, tryParseBigIntId } from '@/common/utils/bigint.util';

export interface AuditLogInput {
  companyId?: string;
  userId?: string;
  performedBy?: string;
  action: UserAuditAction;
  entityName: string;
  entityId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput) {
    return this.prisma.userAudit.create({
      data: {
        companyId: input.companyId ? parseBigIntId(input.companyId, 'companyId') : undefined,
        userId: input.userId ? parseBigIntId(input.userId, 'userId') : undefined,
        performedBy: input.performedBy ? parseBigIntId(input.performedBy, 'performedBy') : undefined,
        action: input.action,
        entityName: input.entityName,
        entityId: tryParseBigIntId(input.entityId),
        oldValue: input.oldValue as Prisma.InputJsonValue,
        newValue: input.newValue as Prisma.InputJsonValue,
        ipAddress: input.ipAddress,
      },
    });
  }
}
