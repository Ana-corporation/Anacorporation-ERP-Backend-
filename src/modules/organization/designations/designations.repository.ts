import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';

const DESIGNATIONS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'designationCode', name: 'name' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['designationCode', 'name'],
  sortFields: ['designationCode', 'name', 'gradeLevel', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class DesignationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      DESIGNATIONS_LIST_FILTER,
    ) as Prisma.DesignationWhereInput;

    return this.prisma.$transaction([
      this.prisma.designation.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, DESIGNATIONS_LIST_FILTER),
      }),
      this.prisma.designation.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.designation.findFirst({
      where: {
        designationId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  findByCode(companyId: string, designationCode: string) {
    return this.prisma.designation.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        designationCode,
        deletedAt: null,
      },
    });
  }

  create(companyId: string, dto: CreateDesignationDto, createdBy?: string) {
    return this.prisma.designation.create({
      data: {
        companyId: parseBigIntId(companyId),
        designationCode: dto.designationCode.trim().toUpperCase(),
        name: dto.name.trim(),
        gradeLevel: dto.gradeLevel,
        isActive: dto.isActive ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateDesignationDto, updatedBy?: string) {
    return this.prisma.designation.update({
      where: { designationId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.gradeLevel !== undefined ? { gradeLevel: dto.gradeLevel } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.designation.update({
      where: { designationId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }
}
