import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const PLATFORM_COMPANIES_FILTER: ListFilterOptions = {
  contains: { name: 'name', code: 'companyCode', email: 'email' },
  exact: { status: 'status' },
  dateRange: { field: 'createdAt' },
  searchFields: ['name', 'companyCode', 'email', 'legalName'],
  sortFields: ['name', 'companyCode', 'createdAt', 'status'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class PlatformCompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere({ deletedAt: null }, query, PLATFORM_COMPANIES_FILTER) as Prisma.CompanyWhereInput;

    return this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, PLATFORM_COMPANIES_FILTER),
        include: {
          subscriptions: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
          _count: {
            select: {
              userCompanies: { where: { deletedAt: null, status: 'active' } },
            },
          },
        },
      }),
      this.prisma.company.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.company.findFirst({
      where: { companyId: parseBigIntId(id), deletedAt: null },
      include: {
        subscriptions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
        securityPolicy: true,
        _count: {
          select: {
            userCompanies: { where: { deletedAt: null, status: 'active' } },
          },
        },
      },
    });
  }

  updateStatus(id: string, status: 'trial' | 'active' | 'suspended' | 'cancelled', updatedBy?: string) {
    return this.prisma.company.update({
      where: { companyId: parseBigIntId(id) },
      data: {
        status,
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }
}
