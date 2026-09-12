import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateCompanyModuleDto, UpdateCompanyModuleDto } from './dto/company-module.dto';

const COMPANY_MODULES_LIST_FILTER: ListFilterOptions = {
  exact: { moduleId: 'moduleId' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  sortFields: ['createdAt', 'activatedDate', 'expiryDate', 'isActive'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class CompanyModulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const baseWhere = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      COMPANY_MODULES_LIST_FILTER,
    ) as Prisma.CompanyModuleWhereInput;

    const where: Prisma.CompanyModuleWhereInput =
      query.search?.trim()
        ? {
            ...baseWhere,
            AND: [
              ...(Array.isArray(baseWhere.AND) ? baseWhere.AND : baseWhere.AND ? [baseWhere.AND] : []),
              {
                module: {
                  OR: [
                    { moduleCode: { contains: query.search.trim(), mode: 'insensitive' } },
                    { moduleName: { contains: query.search.trim(), mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : baseWhere;

    return this.prisma.$transaction([
      this.prisma.companyModule.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, COMPANY_MODULES_LIST_FILTER),
        include: { module: true },
      }),
      this.prisma.companyModule.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.companyModule.findFirst({
      where: {
        companyModuleId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: { module: true },
    });
  }

  findByCompanyAndModule(companyId: string, moduleId: string) {
    return this.prisma.companyModule.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        moduleId: parseBigIntId(moduleId),
      },
      include: { module: true },
    });
  }

  moduleExists(moduleId: string) {
    return this.prisma.module.findFirst({
      where: { moduleId: parseBigIntId(moduleId), deletedAt: null },
    });
  }

  create(companyId: string, dto: CreateCompanyModuleDto, createdBy?: string) {
    return this.prisma.companyModule.create({
      data: {
        companyId: parseBigIntId(companyId),
        moduleId: parseBigIntId(dto.moduleId, 'moduleId'),
        isActive: dto.isActive ?? true,
        isEnabled: dto.isActive ?? true,
        activatedDate: dto.activatedDate ? new Date(dto.activatedDate) : new Date(),
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
      include: { module: true },
    });
  }

  update(id: string, dto: UpdateCompanyModuleDto, updatedBy?: string) {
    return this.prisma.companyModule.update({
      where: { companyModuleId: parseBigIntId(id) },
      data: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive, isEnabled: dto.isActive } : {}),
        ...(dto.enabled !== undefined ? { isEnabled: dto.enabled, isActive: dto.enabled } : {}),
        ...(dto.activatedDate !== undefined ? { activatedDate: new Date(dto.activatedDate) } : {}),
        ...(dto.expiryDate !== undefined
          ? { expiryDate: dto.expiryDate === null ? null : new Date(dto.expiryDate) }
          : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
      include: { module: true },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.companyModule.update({
      where: { companyModuleId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }
}
