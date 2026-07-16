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

const companySummaryInclude = {
  defaultCurrency: true,
  subscriptions: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    include: { plan: true },
  },
  companyModules: {
    where: { deletedAt: null },
    select: { isActive: true, moduleId: true },
  },
  _count: {
    select: {
      userCompanies: { where: { deletedAt: null, status: 'active' as const } },
    },
  },
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
        include: companySummaryInclude,
      }),
      this.prisma.company.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.company.findFirst({
      where: { companyId: parseBigIntId(id), deletedAt: null },
      include: companySummaryInclude,
    });
  }

  findByCode(code: string) {
    return this.prisma.company.findFirst({
      where: { companyCode: code, deletedAt: null },
    });
  }

  async createWithBootstrap(dto: CreateCompanyDto, createdBy?: string) {
    const actorId = createdBy ? parseBigIntId(createdBy, 'createdBy') : undefined;

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          companyCode: dto.companyCode.trim().toUpperCase(),
          name: dto.name.trim(),
          legalName: dto.legalName,
          domain: dto.domain,
          email: dto.email,
          phone: dto.phone,
          city: dto.city,
          country: dto.country,
          logoUrl: dto.logoUrl ?? undefined,
          timezone: dto.timezone ?? 'UTC',
          status: dto.status ?? 'trial',
          defaultCurrencyId: dto.defaultCurrencyId
            ? parseBigIntId(dto.defaultCurrencyId, 'defaultCurrencyId')
            : undefined,
          createdBy: actorId,
        },
      });

      await tx.companySecurityPolicy.create({
        data: {
          companyId: company.companyId,
          createdBy: actorId,
        },
      });

      const adminRole = await tx.role.create({
        data: {
          companyId: company.companyId,
          roleCode: 'ADMIN',
          roleName: 'Administrator',
          description: 'Full company administrator',
          isSystem: true,
          createdBy: actorId,
        },
      });

      const adminPermissions = await tx.permission.findMany({
        where: {
          OR: [
            { permissionCode: { startsWith: 'companies:' } },
            { permissionCode: { startsWith: 'users:' } },
            { permissionCode: { startsWith: 'roles:' } },
            { permissionCode: { startsWith: 'departments:' } },
            { permissionCode: { startsWith: 'branches:' } },
            { permissionCode: { startsWith: 'designations:' } },
            { permissionCode: { startsWith: 'warehouses:' } },
            { permissionCode: { startsWith: 'company_subscriptions:' } },
            { permissionCode: { startsWith: 'company_modules:' } },
          ],
        },
      });

      if (adminPermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: adminPermissions.map((p) => ({
            roleId: adminRole.roleId,
            moduleId: p.moduleId,
            permissionId: p.permissionId,
            isAllowed: true,
            createdBy: actorId,
          })),
          skipDuplicates: true,
        });
      }

      return tx.company.findFirst({
        where: { companyId: company.companyId },
        include: companySummaryInclude,
      });
    });
  }

  create(dto: CreateCompanyDto, createdBy?: string) {
    return this.createWithBootstrap(dto, createdBy);
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
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.country !== undefined ? { country: dto.country } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.defaultCurrencyId !== undefined
          ? {
              defaultCurrencyId: dto.defaultCurrencyId
                ? parseBigIntId(dto.defaultCurrencyId, 'defaultCurrencyId')
                : null,
            }
          : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy, 'updatedBy') : undefined,
        updatedAt: new Date(),
      },
      include: companySummaryInclude,
    });
  }

  updateStatus(
    id: string,
    status: 'trial' | 'active' | 'suspended' | 'cancelled',
    updatedBy?: string,
  ) {
    return this.prisma.company.update({
      where: { companyId: parseBigIntId(id) },
      data: {
        status,
        updatedBy: updatedBy ? parseBigIntId(updatedBy, 'updatedBy') : undefined,
        updatedAt: new Date(),
      },
      include: companySummaryInclude,
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
