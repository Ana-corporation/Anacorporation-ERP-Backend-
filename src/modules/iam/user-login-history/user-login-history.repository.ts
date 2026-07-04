import { Injectable } from '@nestjs/common';
import { LoginResult, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_LOGIN_HISTORY_LIST_FILTER: ListFilterOptions = {
  exact: { loginResult: 'loginResult' },
  contains: { browser: 'browser', os: 'os' },
  dateRange: { field: 'loginDate' },
  searchFields: ['browser', 'device', 'ipAddress', 'failureReason'],
  sortFields: ['loginDate', 'loginResult', 'browser'],
  defaultSortField: 'loginDate',
};

@Injectable()
export class UserLoginHistoryRepository {
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
      USER_LOGIN_HISTORY_LIST_FILTER,
    ) as Prisma.UserLoginHistoryWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userLoginHistory.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_LOGIN_HISTORY_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userLoginHistory.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string) {
    return this.prisma.userLoginHistory.findFirst({
      where: {
        loginHistoryId: parseBigIntId(id),
        userId: parseBigIntId(userId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    companyId?: string | null;
    loginDate?: Date;
    loginResult: LoginResult;
    failureReason?: string;
    ipAddress?: string;
    browser?: string;
    device?: string;
    country?: string;
    city?: string;
    sessionDuration?: number;
  }) {
    return this.prisma.userLoginHistory.create({
      data: {
        userId: parseBigIntId(data.userId),
        companyId: data.companyId ? parseBigIntId(data.companyId) : null,
        loginDate: data.loginDate,
        loginResult: data.loginResult,
        failureReason: data.failureReason,
        ipAddress: data.ipAddress,
        browser: data.browser,
        device: data.device,
        country: data.country,
        city: data.city,
        sessionDuration: data.sessionDuration,
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userLoginHistory.delete({
      where: { loginHistoryId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      loginHistoryId: true,
      userId: true,
      companyId: true,
      loginDate: true,
      loginResult: true,
      failureReason: true,
      ipAddress: true,
      browser: true,
      device: true,
      country: true,
      city: true,
      sessionDuration: true,
    } satisfies Prisma.UserLoginHistorySelect;
  }
}
