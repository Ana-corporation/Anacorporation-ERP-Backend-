import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

const BRANCHES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'branchCode', name: 'name', city: 'city', country: 'country' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['branchCode', 'name', 'city', 'address'],
  sortFields: ['branchCode', 'name', 'createdAt', 'city', 'country'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class BranchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      BRANCHES_LIST_FILTER,
    ) as Prisma.BranchWhereInput;

    return this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, BRANCHES_LIST_FILTER),
      }),
      this.prisma.branch.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.branch.findFirst({
      where: { branchId: parseBigIntId(id), companyId: parseBigIntId(companyId), deletedAt: null },
    });
  }

  findByCode(companyId: string, branchCode: string) {
    return this.prisma.branch.findFirst({
      where: { companyId: parseBigIntId(companyId), branchCode, deletedAt: null },
    });
  }

  create(companyId: string, dto: CreateBranchDto & { branchCode: string }, createdBy?: string) {
    return this.prisma.branch.create({
      data: {
        companyId: parseBigIntId(companyId),
        branchCode: dto.branchCode.trim().toUpperCase(),
        name: dto.name.trim(),
        address: dto.address,
        city: dto.city,
        country: dto.country,
        phone: dto.phone,
        isActive: dto.isActive ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateBranchDto, updatedBy?: string) {
    return this.prisma.branch.update({
      where: { branchId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.country !== undefined ? { country: dto.country } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.branch.update({
      where: { branchId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }
}
