import { Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';

@Injectable()
export class CompanyAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyByCompany(companyId: string, query: PaginationQueryDto & { from?: string; to?: string }) {
    const raw = getPaginationParams(query);
    const page = Number(raw.page) || 1;
    const limit = Number(raw.limit) || 20;
    const skip = Number(raw.skip) || 0;
    const cid = parseBigIntId(companyId);

    const where: Prisma.UserAuditWhereInput = {
      companyId: cid,
    };

    const action = query.action?.trim();
    if (action) {
      const lifecycleHints: Record<string, { entityName?: string; status?: string }> = {
        COMPANY_SUSPENDED: { entityName: 'Company', status: 'suspended' },
        COMPANY_ACTIVATED: { entityName: 'Company', status: 'active' },
        COMPANY_SET_TRIAL: { entityName: 'Company', status: 'trial' },
        COMPANY_CREATED: { entityName: 'Company' },
        COMPANY_UPDATED: { entityName: 'Company' },
        PLAN_ASSIGNED: { entityName: 'CompanySubscription' },
        SUBSCRIPTION_CHANGED: { entityName: 'CompanySubscription' },
        MODULE_ENABLED: { entityName: 'CompanyModule' },
        MODULE_DISABLED: { entityName: 'CompanyModule' },
        ADMIN_INVITED: { entityName: 'UserInvite' },
      };

      const hint = lifecycleHints[action.toUpperCase()];
      if (hint?.entityName) {
        where.entityName = hint.entityName;
      } else if ((Object.values(UserAuditAction) as string[]).includes(action)) {
        where.action = action as UserAuditAction;
      } else {
        where.entityName = { contains: action, mode: 'insensitive' };
      }
    }

    const from = query.from || query.fromDate;
    const to = query.to || query.toDate;
    if (from || to) {
      where.performedAt = {};
      if (from) where.performedAt.gte = new Date(from);
      if (to) {
        const end = new Date(to);
        // Inclusive end-of-day if date-only
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          end.setUTCHours(23, 59, 59, 999);
        }
        where.performedAt.lte = end;
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAudit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { performedAt: 'desc' },
        include: {
          user: {
            select: {
              userId: true,
              email: true,
              displayName: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          },
        },
      }),
      this.prisma.userAudit.count({ where }),
    ]);

    // Resolve performers in one query
    const performerIds = [
      ...new Set(
        items
          .map((row) => row.performedBy)
          .filter((id): id is bigint => id != null)
          .map((id) => id.toString()),
      ),
    ];

    const performers =
      performerIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { userId: { in: performerIds.map((id) => BigInt(id)) } },
            select: {
              userId: true,
              email: true,
              displayName: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          });

    const performerById = new Map(performers.map((u) => [u.userId.toString(), u]));

    return {
      items: items.map((row) => ({
        ...row,
        performer: row.performedBy
          ? performerById.get(row.performedBy.toString()) ?? null
          : null,
      })),
      total,
      page,
      limit,
    };
  }
}
