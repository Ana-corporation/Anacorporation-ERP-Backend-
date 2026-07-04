import { Injectable } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_AUDIT_LIST_FILTER: ListFilterOptions = {
  exact: { action: 'action' },
  contains: { entityName: 'entityName' },
  dateRange: { field: 'performedAt' },
  searchFields: ['entityName', 'ipAddress'],
  sortFields: ['performedAt', 'action', 'entityName'],
  defaultSortField: 'performedAt',
};

@Injectable()
export class UserAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  assertUserInCompany(userId: string, companyId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'active',
      },
    });
  }

  async findManyByUser(userId: string, companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      {
        userId: parseBigIntId(userId),
        OR: [{ companyId: parseBigIntId(companyId) }, { companyId: null }],
      },
      query,
      USER_AUDIT_LIST_FILTER,
    ) as Prisma.UserAuditWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAudit.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_AUDIT_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userAudit.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string) {
    return this.prisma.userAudit.findFirst({
      where: {
        auditId: parseBigIntId(id),
        userId: parseBigIntId(userId),
      },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      auditId: true,
      userId: true,
      companyId: true,
      action: true,
      entityName: true,
      entityId: true,
      performedBy: true,
      performedAt: true,
      ipAddress: true,
    } satisfies Prisma.UserAuditSelect;
  }
}
