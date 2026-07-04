import { Injectable } from '@nestjs/common';
import { ModuleAccessType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const USER_MODULE_ACCESS_LIST_FILTER: ListFilterOptions = {
  exact: { moduleId: 'moduleId', accessType: 'accessType' },
  dateRange: { field: 'createdAt' },
  searchFields: ['reason'],
  sortFields: ['createdAt', 'accessType', 'expiryDate'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UserModuleAccessRepository {
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

  findModuleById(moduleId: string) {
    return this.prisma.module.findFirst({
      where: { moduleId: parseBigIntId(moduleId), deletedAt: null },
      select: { moduleId: true, moduleCode: true, moduleName: true },
    });
  }

  findByUserCompanyModule(userId: string, companyId: string, moduleId: string) {
    return this.prisma.userModuleAccess.findUnique({
      where: {
        userId_companyId_moduleId: {
          userId: parseBigIntId(userId),
          companyId: parseBigIntId(companyId),
          moduleId: parseBigIntId(moduleId),
        },
      },
      select: this.publicSelect(),
    });
  }

  async findManyByUser(userId: string, companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const baseWhere = buildListWhere(
      { userId: parseBigIntId(userId), companyId: parseBigIntId(companyId) },
      query,
      USER_MODULE_ACCESS_LIST_FILTER,
    ) as Prisma.UserModuleAccessWhereInput;

    const where: Prisma.UserModuleAccessWhereInput =
      query.search?.trim()
        ? {
            ...baseWhere,
            AND: [
              ...(Array.isArray(baseWhere.AND) ? baseWhere.AND : baseWhere.AND ? [baseWhere.AND] : []),
              {
                OR: [
                  { reason: { contains: query.search.trim(), mode: 'insensitive' } },
                  { module: { moduleName: { contains: query.search.trim(), mode: 'insensitive' } } },
                  { module: { moduleCode: { contains: query.search.trim(), mode: 'insensitive' } } },
                ],
              },
            ],
          }
        : baseWhere;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userModuleAccess.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USER_MODULE_ACCESS_LIST_FILTER),
        select: this.publicSelect(),
      }),
      this.prisma.userModuleAccess.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  findById(id: string, userId: string, companyId: string) {
    return this.prisma.userModuleAccess.findFirst({
      where: {
        userModuleAccessId: parseBigIntId(id),
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
      },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    companyId: string;
    moduleId: string;
    accessType: ModuleAccessType;
    reason?: string;
    expiryDate?: Date | null;
    createdBy: string;
  }) {
    return this.prisma.userModuleAccess.create({
      data: {
        userId: parseBigIntId(data.userId),
        companyId: parseBigIntId(data.companyId),
        moduleId: parseBigIntId(data.moduleId),
        accessType: data.accessType,
        reason: data.reason,
        expiryDate: data.expiryDate,
        createdBy: parseBigIntId(data.createdBy),
      },
      select: this.publicSelect(),
    });
  }

  update(
    id: string,
    data: {
      accessType?: ModuleAccessType;
      reason?: string | null;
      expiryDate?: Date | null;
    },
  ) {
    return this.prisma.userModuleAccess.update({
      where: { userModuleAccessId: parseBigIntId(id) },
      data: {
        ...(data.accessType !== undefined ? { accessType: data.accessType } : {}),
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
        ...(data.expiryDate !== undefined ? { expiryDate: data.expiryDate } : {}),
        rowVersion: { increment: 1 },
      },
      select: this.publicSelect(),
    });
  }

  delete(id: string) {
    return this.prisma.userModuleAccess.delete({
      where: { userModuleAccessId: parseBigIntId(id) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      userModuleAccessId: true,
      userId: true,
      companyId: true,
      moduleId: true,
      accessType: true,
      reason: true,
      expiryDate: true,
      createdBy: true,
      createdAt: true,
      rowVersion: true,
      module: {
        select: {
          moduleId: true,
          moduleCode: true,
          moduleName: true,
        },
      },
    } satisfies Prisma.UserModuleAccessSelect;
  }
}
