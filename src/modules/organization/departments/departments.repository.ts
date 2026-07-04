import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

const DEPARTMENTS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'departmentCode', name: 'name' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['departmentCode', 'name'],
  sortFields: ['departmentCode', 'name', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class DepartmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      DEPARTMENTS_LIST_FILTER,
    ) as Prisma.DepartmentWhereInput;

    return this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, DEPARTMENTS_LIST_FILTER),
        include: { parent: true },
      }),
      this.prisma.department.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.department.findFirst({
      where: {
        departmentId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: { parent: true, children: { where: { deletedAt: null } } },
    });
  }

  findByCode(companyId: string, departmentCode: string) {
    return this.prisma.department.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        departmentCode,
        deletedAt: null,
      },
    });
  }

  create(companyId: string, dto: CreateDepartmentDto, createdBy?: string) {
    return this.prisma.department.create({
      data: {
        companyId: parseBigIntId(companyId),
        departmentCode: dto.departmentCode.trim().toUpperCase(),
        name: dto.name.trim(),
        parentDepartmentId: dto.parentDepartmentId
          ? parseBigIntId(dto.parentDepartmentId, 'parentDepartmentId')
          : undefined,
        isActive: dto.isActive ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
      include: { parent: true },
    });
  }

  update(id: string, dto: UpdateDepartmentDto, updatedBy?: string) {
    return this.prisma.department.update({
      where: { departmentId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.parentDepartmentId !== undefined
          ? {
              parentDepartmentId: dto.parentDepartmentId
                ? parseBigIntId(dto.parentDepartmentId, 'parentDepartmentId')
                : null,
            }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
      include: { parent: true },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.department.update({
      where: { departmentId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }
}
