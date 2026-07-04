import { Injectable } from '@nestjs/common';
import { DelegationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_DELEGATIONS_LIST_FILTER: ListFilterOptions = {
  exact: { status: 'status' },
  dateRange: { field: 'startDate' },
  searchFields: ['reason'],
  sortFields: ['createdAt', 'startDate', 'endDate', 'status'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UserDelegationsRepository {
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
      { userId: parseBigIntId(userId), companyId: parseBigIntId(companyId) },
      query,
      USER_DELEGATIONS_LIST_FILTER,
    ) as Prisma.UserDelegationWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userDelegation.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_DELEGATIONS_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userDelegation.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string, companyId: string) {
    return this.prisma.userDelegation.findFirst({
      where: {
        delegationId: parseBigIntId(id),
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    delegateUserId: string;
    companyId: string;
    startDate: Date;
    endDate?: Date;
    reason?: string;
    status: DelegationStatus;
    createdBy: string;
  }) {
    return this.prisma.userDelegation.create({
      data: {
        userId: parseBigIntId(data.userId),
        delegateUserId: parseBigIntId(data.delegateUserId),
        companyId: parseBigIntId(data.companyId),
        startDate: data.startDate,
        endDate: data.endDate,
        reason: data.reason,
        status: data.status,
        createdBy: parseBigIntId(data.createdBy),
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      startDate?: Date;
      endDate?: Date | null;
      reason?: string | null;
      status?: DelegationStatus;
    },
  ) {
    return this.prisma.userDelegation.update({
      where: { delegationId: parseBigIntId(id) },
      data: {
        ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
        ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userDelegation.delete({
      where: { delegationId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      delegationId: true,
      userId: true,
      delegateUserId: true,
      companyId: true,
      startDate: true,
      endDate: true,
      reason: true,
      status: true,
      createdBy: true,
      createdAt: true,
    } satisfies Prisma.UserDelegationSelect;
  }
}
