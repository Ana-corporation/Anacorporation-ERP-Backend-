import { Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId, tryParseBigIntId } from '@/common/utils/bigint.util';
import {
  actorDisplayName,
  applyAuditActors,
  collectActorIds,
  RecordAuditFields,
} from '@/common/utils/record-audit.util';

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

  async loadActorNames(userIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(userIds.filter((id) => /^\d+$/.test(id)))];
    if (unique.length === 0) return names;

    const users = await this.prisma.user.findMany({
      where: { userId: { in: unique.map((id) => BigInt(id)) } },
      select: {
        userId: true,
        displayName: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    });

    for (const user of users) {
      names.set(user.userId.toString(), actorDisplayName(user));
    }
    return names;
  }

  async withAuditList<T extends Record<string, unknown>>(
    records: T[],
  ): Promise<Array<T & RecordAuditFields>> {
    const names = await this.loadActorNames(collectActorIds(records));
    return records.map((record) => applyAuditActors(record, names));
  }

  async withAudit<T extends Record<string, unknown>>(record: T): Promise<T & RecordAuditFields> {
    const [row] = await this.withAuditList([record]);
    return row;
  }
}
