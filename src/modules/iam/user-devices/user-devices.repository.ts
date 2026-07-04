import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_DEVICES_LIST_FILTER: ListFilterOptions = {
  contains: { deviceUuid: 'deviceUuid', browser: 'browser', os: 'os', manufacturer: 'manufacturer' },
  booleans: { isTrusted: 'isTrusted', isBlocked: 'isBlocked' },
  dateRange: { field: 'createdAt' },
  searchFields: ['deviceUuid', 'deviceName', 'manufacturer', 'model', 'os', 'browser'],
  sortFields: ['createdAt', 'lastSeen', 'deviceName', 'deviceUuid'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UserDevicesRepository {
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

  findByDeviceUuid(userId: string, deviceUuid: string) {
    return this.prisma.userDevice.findUnique({
      where: {
        userId_deviceUuid: {
          userId: parseBigIntId(userId),
          deviceUuid,
        },
      },
      select: this.publicSelect(),
    });
  }

  async findManyByUser(userId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { userId: parseBigIntId(userId) },
      query,
      USER_DEVICES_LIST_FILTER,
    ) as Prisma.UserDeviceWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userDevice.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_DEVICES_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userDevice.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string) {
    return this.prisma.userDevice.findFirst({
      where: {
        deviceId: parseBigIntId(id),
        userId: parseBigIntId(userId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    deviceUuid: string;
    deviceName?: string;
    manufacturer?: string;
    model?: string;
    os?: string;
    browser?: string;
    lastSeen?: Date;
    isTrusted: boolean;
    isBlocked: boolean;
  }) {
    return this.prisma.userDevice.create({
      data: {
        userId: parseBigIntId(data.userId),
        deviceUuid: data.deviceUuid,
        deviceName: data.deviceName,
        manufacturer: data.manufacturer,
        model: data.model,
        os: data.os,
        browser: data.browser,
        lastSeen: data.lastSeen,
        isTrusted: data.isTrusted,
        isBlocked: data.isBlocked,
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      deviceName?: string | null;
      manufacturer?: string | null;
      model?: string | null;
      os?: string | null;
      browser?: string | null;
      lastSeen?: Date | null;
      isTrusted?: boolean;
      isBlocked?: boolean;
    },
  ) {
    return this.prisma.userDevice.update({
      where: { deviceId: parseBigIntId(id) },
      data: {
        ...(data.deviceName !== undefined ? { deviceName: data.deviceName } : {}),
        ...(data.manufacturer !== undefined ? { manufacturer: data.manufacturer } : {}),
        ...(data.model !== undefined ? { model: data.model } : {}),
        ...(data.os !== undefined ? { os: data.os } : {}),
        ...(data.browser !== undefined ? { browser: data.browser } : {}),
        ...(data.lastSeen !== undefined ? { lastSeen: data.lastSeen } : {}),
        ...(data.isTrusted !== undefined ? { isTrusted: data.isTrusted } : {}),
        ...(data.isBlocked !== undefined ? { isBlocked: data.isBlocked } : {}),
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userDevice.delete({
      where: { deviceId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      deviceId: true,
      userId: true,
      deviceUuid: true,
      deviceName: true,
      manufacturer: true,
      model: true,
      os: true,
      browser: true,
      lastSeen: true,
      isTrusted: true,
      isBlocked: true,
      createdAt: true,
    } satisfies Prisma.UserDeviceSelect;
  }
}
