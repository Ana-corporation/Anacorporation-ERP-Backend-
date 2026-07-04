import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

const COMPANIES_LIST_FILTER: ListFilterOptions = {
  contains: { name: 'name', code: 'companyCode', email: 'email' },
  exact: { status: 'status' },
  dateRange: { field: 'createdAt' },
  searchFields: ['name', 'companyCode', 'email', 'legalName'],
  sortFields: ['name', 'companyCode', 'createdAt', 'status'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class CompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere({ deletedAt: null }, query, COMPANIES_LIST_FILTER) as Prisma.CompanyWhereInput;

    return this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, COMPANIES_LIST_FILTER),
        include: { defaultCurrency: true },
      }),
      this.prisma.company.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.company.findFirst({
      where: { companyId: parseBigIntId(id), deletedAt: null },
      include: { defaultCurrency: true },
    });
  }

  findByCode(code: string) {
    return this.prisma.company.findFirst({
      where: { companyCode: code, deletedAt: null },
    });
  }

  create(dto: CreateCompanyDto, createdBy?: string) {
    return this.prisma.company.create({
      data: {
        companyCode: dto.companyCode.trim().toUpperCase(),
        name: dto.name.trim(),
        legalName: dto.legalName,
        domain: dto.domain,
        email: dto.email,
        phone: dto.phone,
        timezone: dto.timezone ?? 'UTC',
        defaultCurrencyId: dto.defaultCurrencyId
          ? parseBigIntId(dto.defaultCurrencyId, 'defaultCurrencyId')
          : undefined,
        createdBy: createdBy ? parseBigIntId(createdBy, 'createdBy') : undefined,
      },
      include: { defaultCurrency: true },
    });
  }

  update(id: string, dto: UpdateCompanyDto, updatedBy?: string) {
    return this.prisma.company.update({
      where: { companyId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
        ...(dto.domain !== undefined ? { domain: dto.domain } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.defaultCurrencyId !== undefined
          ? { defaultCurrencyId: parseBigIntId(dto.defaultCurrencyId, 'defaultCurrencyId') }
          : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy, 'updatedBy') : undefined,
        updatedAt: new Date(),
      },
      include: { defaultCurrency: true },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.company.update({
      where: { companyId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy, 'deletedBy') : undefined,
      },
    });
  }
}
