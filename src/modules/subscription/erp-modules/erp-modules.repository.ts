import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateErpModuleDto, UpdateErpModuleDto } from './dto/erp-module.dto';

const ERP_MODULES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'moduleCode', name: 'moduleName' },
  exact: {
    moduleId: 'moduleId',
    moduleType: 'moduleType',
    lifecycleStatus: 'lifecycleStatus',
  },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['moduleCode', 'moduleName', 'description'],
  sortFields: ['sortOrder', 'moduleCode', 'moduleName', 'createdAt', 'lifecycleStatus'],
  defaultSortField: 'sortOrder',
};

@Injectable()
export class ErpModulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere({ deletedAt: null }, query, ERP_MODULES_LIST_FILTER) as Prisma.ModuleWhereInput;

    return this.prisma.$transaction([
      this.prisma.module.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, ERP_MODULES_LIST_FILTER),
        include: { parent: true },
      }),
      this.prisma.module.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.module.findFirst({
      where: { moduleId: parseBigIntId(id), deletedAt: null },
      include: { parent: true, children: { where: { deletedAt: null } } },
    });
  }

  findByCode(moduleCode: string) {
    return this.prisma.module.findFirst({
      where: { moduleCode, deletedAt: null },
    });
  }

  /** AVAILABLE product modules for Company → Modules & Entitlements grant picker. */
  findGrantable() {
    return this.prisma.module.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        moduleType: 'product',
        lifecycleStatus: 'AVAILABLE',
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  create(dto: CreateErpModuleDto, createdBy?: string) {
    return this.prisma.module.create({
      data: {
        moduleCode: dto.moduleCode.trim().toLowerCase(),
        moduleName: dto.moduleName.trim(),
        description: dto.description,
        icon: dto.icon,
        parentModuleId: dto.parentModuleId
          ? parseBigIntId(dto.parentModuleId, 'parentModuleId')
          : undefined,
        sortOrder: dto.sortOrder ?? 0,
        moduleType: dto.moduleType ?? 'product',
        lifecycleStatus: dto.lifecycleStatus ?? 'DEVELOPMENT',
        isActive: dto.isActive ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
      include: { parent: true },
    });
  }

  update(id: string, dto: UpdateErpModuleDto, updatedBy?: string) {
    return this.prisma.module.update({
      where: { moduleId: parseBigIntId(id) },
      data: {
        ...(dto.moduleName !== undefined ? { moduleName: dto.moduleName.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.parentModuleId !== undefined
          ? {
              parentModuleId: dto.parentModuleId
                ? parseBigIntId(dto.parentModuleId, 'parentModuleId')
                : null,
            }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.moduleType !== undefined ? { moduleType: dto.moduleType } : {}),
        ...(dto.lifecycleStatus !== undefined
          ? { lifecycleStatus: dto.lifecycleStatus }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
      include: { parent: true },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.module.update({
      where: { moduleId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }
}
