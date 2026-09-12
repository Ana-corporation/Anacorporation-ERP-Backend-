import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { parseAutoCompanySequence } from './company-code.util';

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

  private toDateOnly(value: Date | null | undefined): string | null {
    if (!value) return null;
    return value.toISOString().slice(0, 10);
  }

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
      where: { companyCode: code.trim().toUpperCase() },
    });
  }

  async nextAutoCompanySequence() {
    const rows = await this.prisma.company.findMany({
      where: { companyCode: { startsWith: 'CO-' } },
      select: { companyCode: true },
    });
    let maxSeq = 0;
    for (const row of rows) {
      const seq = parseAutoCompanySequence(row.companyCode);
      if (seq !== null && seq > maxSeq) maxSeq = seq;
    }
    return maxSeq + 1;
  }

  create(dto: CreateCompanyDto, createdBy?: string) {
    const companyCode = dto.companyCode?.trim().toUpperCase();
    if (!companyCode) {
      throw new Error('companyCode is required at persist time');
    }
    return this.prisma.company.create({
      data: {
        companyCode,
        name: dto.name.trim(),
        country: dto.country.trim(),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        legalName: dto.legalName,
        domain: dto.domain,
        email: dto.email,
        phone: dto.phone,
        city: dto.city,
        logoUrl: dto.logoUrl ?? undefined,
        timezone: dto.timezone ?? 'UTC',
        defaultCurrencyId: dto.defaultCurrencyId
          ? parseBigIntId(dto.defaultCurrencyId, 'defaultCurrencyId')
          : undefined,
        createdBy: createdBy ? parseBigIntId(createdBy, 'createdBy') : undefined,
      },
      include: companySummaryInclude,
    });
  }

  update(id: string, dto: UpdateCompanyDto, updatedBy?: string) {
    return this.prisma.company.update({
      where: { companyId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.country !== undefined ? { country: dto.country.trim() } : {}),
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

  async updateStatus(
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
    });
  }

  /**
   * FE contract (Phase A):
   * PATCH /companies/:id/status must return:
   *  companyId, companyCode, name, status,
   *  subscriptionStatus, planCode, planName, subscriptionEndDate,
   *  activeModuleCount, entitledModuleCount, userCount
   */
  async findPlatformCompanySummary(id: string) {
    const companyId = parseBigIntId(id);

    const company = await this.prisma.company.findFirst({
      where: { companyId, deletedAt: null },
      include: { defaultCurrency: true },
    });
    if (!company) throw new NotFoundException('Company');

    const liveSubscription = await this.prisma.companySubscription.findFirst({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['active', 'trial', 'pending'] },
      },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    const [activeUserCount, pendingInviteCount, primaryMembership, fallbackAdminRole] =
      await Promise.all([
      this.prisma.userCompany.count({
        where: { companyId, deletedAt: null, status: 'active' },
      }),
      this.prisma.userCompany.count({
        where: { companyId, deletedAt: null, status: 'invited' },
      }),
      this.prisma.userCompany.findFirst({
        where: {
          companyId,
          deletedAt: null,
          isPrimaryAdmin: true,
          status: { in: ['active', 'invited'] },
          user: { deletedAt: null },
        },
        include: {
          user: {
            select: {
              email: true,
              displayName: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          },
        },
      }),
      this.prisma.userRole.findFirst({
        where: {
          companyId,
          isActive: true,
          role: { roleCode: 'ADMIN', deletedAt: null },
          user: {
            deletedAt: null,
            companies: {
              some: { companyId, deletedAt: null, status: { in: ['active', 'invited'] } },
            },
          },
        },
        include: {
          user: {
            select: {
              email: true,
              displayName: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          },
        },
        orderBy: { roleId: 'asc' },
      }),
    ]);

    let activeModuleCount = 0;
    let entitledModuleCount = 0;

    if (liveSubscription?.planId) {
      const planModuleIds = await this.prisma.planModule.findMany({
        where: { planId: liveSubscription.planId },
        select: { moduleId: true },
      });

      const companyModules = await this.prisma.companyModule.findMany({
        where: { companyId, deletedAt: null },
        select: { moduleId: true, isActive: true, expiryDate: true },
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const planSet = new Set(planModuleIds.map((r) => r.moduleId.toString()));
      const entitled = new Set<string>(planSet);
      const activeByModuleId = new Map<string, boolean>();

      for (const row of companyModules) {
        const key = row.moduleId.toString();
        const notExpired = !row.expiryDate || row.expiryDate >= today;

        if (row.isActive && notExpired) {
          entitled.add(key);
          activeByModuleId.set(key, true);
        } else if (!row.isActive) {
          entitled.delete(key);
          activeByModuleId.set(key, false);
        } else if (row.isActive) {
          activeByModuleId.set(key, true);
        }
      }

      for (const idStr of planSet) {
        if (!activeByModuleId.has(idStr)) {
          activeByModuleId.set(idStr, true);
        }
      }

      const entitledIdStr = [...entitled];
      if (entitledIdStr.length > 0) {
        const entitledModuleIdBig = entitledIdStr.map((s) => BigInt(s));
        const productModules = await this.prisma.module.findMany({
          where: {
            moduleId: { in: entitledModuleIdBig },
            moduleType: 'product',
            isActive: true,
            deletedAt: null,
            lifecycleStatus: { in: ['AVAILABLE', 'DEPRECATED'] },
          },
          select: { moduleId: true },
        });

        entitledModuleCount = productModules.length;
        activeModuleCount = productModules.reduce((acc, m) => {
          const key = m.moduleId.toString();
          const active = activeByModuleId.get(key);
          return acc + (active === false ? 0 : 1);
        }, 0);
      }
    }

    const primaryUser = primaryMembership?.user ?? fallbackAdminRole?.user;
    const primaryAdminName = primaryUser
      ? primaryUser.displayName?.trim() ||
        [primaryUser.firstName, primaryUser.lastName].filter(Boolean).join(' ').trim() ||
        primaryUser.username
      : null;

    return {
      ...company,
      companyId: company.companyId.toString(),
      companyCode: company.companyCode,
      name: company.name,
      status: company.status,
      createdAt: company.createdAt,

      subscriptionStatus: liveSubscription?.status ?? null,
      planCode: liveSubscription?.plan?.planCode ?? null,
      planName: liveSubscription?.plan?.name ?? null,
      subscriptionEndDate: this.toDateOnly(liveSubscription?.endDate),
      billingCycle: liveSubscription?.billingCycle ?? null,
      userLimit: liveSubscription?.plan?.maxUsers ?? null,
      userUsage: activeUserCount,

      activeModuleCount,
      entitledModuleCount,
      userCount: activeUserCount,
      activeUserCount,
      pendingInviteCount,
      primaryAdminEmail: primaryUser?.email ?? null,
      primaryAdminName,
    };
  }
}
