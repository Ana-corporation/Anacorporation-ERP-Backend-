import { Injectable } from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_SESSIONS_LIST_FILTER: ListFilterOptions = {
  exact: { sessionStatus: 'sessionStatus' },
  contains: { browser: 'browser' },
  dateRange: { field: 'loginTime' },
  searchFields: ['browser', 'deviceName', 'ipAddress'],
  sortFields: ['loginTime', 'logoutTime', 'sessionStatus'],
  defaultSortField: 'loginTime',
};

@Injectable()
export class UserSessionsRepository {
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
      USER_SESSIONS_LIST_FILTER,
    ) as Prisma.UserSessionWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_SESSIONS_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userSession.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string) {
    return this.prisma.userSession.findFirst({
      where: {
        sessionId: parseBigIntId(id),
        userId: parseBigIntId(userId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    companyId?: string | null;
    deviceId?: string | null;
    loginTime?: Date;
    logoutTime?: Date | null;
    jwtToken?: string;
    refreshToken?: string;
    browser?: string;
    browserVersion?: string;
    operatingSystem?: string;
    deviceType?: string;
    deviceName?: string;
    ipAddress?: string;
    country?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    sessionStatus: SessionStatus;
  }) {
    return this.prisma.userSession.create({
      data: {
        userId: parseBigIntId(data.userId),
        companyId: data.companyId ? parseBigIntId(data.companyId) : null,
        deviceId: data.deviceId ? parseBigIntId(data.deviceId) : null,
        loginTime: data.loginTime,
        logoutTime: data.logoutTime,
        jwtToken: data.jwtToken,
        refreshToken: data.refreshToken,
        browser: data.browser,
        browserVersion: data.browserVersion,
        operatingSystem: data.operatingSystem,
        deviceType: data.deviceType,
        deviceName: data.deviceName,
        ipAddress: data.ipAddress,
        country: data.country,
        city: data.city,
        latitude: data.latitude,
        longitude: data.longitude,
        sessionStatus: data.sessionStatus,
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      logoutTime?: Date | null;
      browser?: string | null;
      browserVersion?: string | null;
      operatingSystem?: string | null;
      deviceType?: string | null;
      deviceName?: string | null;
      ipAddress?: string | null;
      country?: string | null;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      sessionStatus?: SessionStatus;
    },
  ) {
    return this.prisma.userSession.update({
      where: { sessionId: parseBigIntId(id) },
      data: {
        ...(data.logoutTime !== undefined ? { logoutTime: data.logoutTime } : {}),
        ...(data.browser !== undefined ? { browser: data.browser } : {}),
        ...(data.browserVersion !== undefined ? { browserVersion: data.browserVersion } : {}),
        ...(data.operatingSystem !== undefined ? { operatingSystem: data.operatingSystem } : {}),
        ...(data.deviceType !== undefined ? { deviceType: data.deviceType } : {}),
        ...(data.deviceName !== undefined ? { deviceName: data.deviceName } : {}),
        ...(data.ipAddress !== undefined ? { ipAddress: data.ipAddress } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
        ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        ...(data.sessionStatus !== undefined ? { sessionStatus: data.sessionStatus } : {}),
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userSession.delete({
      where: { sessionId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      sessionId: true,
      userId: true,
      companyId: true,
      deviceId: true,
      loginTime: true,
      logoutTime: true,
      browser: true,
      browserVersion: true,
      operatingSystem: true,
      deviceType: true,
      deviceName: true,
      ipAddress: true,
      country: true,
      city: true,
      latitude: true,
      longitude: true,
      sessionStatus: true,
    } satisfies Prisma.UserSessionSelect;
  }
}
