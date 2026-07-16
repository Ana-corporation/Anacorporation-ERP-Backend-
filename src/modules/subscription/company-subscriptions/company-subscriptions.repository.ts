import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateCompanySubscriptionDto, UpdateCompanySubscriptionDto } from './dto/company-subscription.dto';

const COMPANY_SUBSCRIPTIONS_LIST_FILTER: ListFilterOptions = {
  exact: { status: 'status', planId: 'planId' },
  dateRange: { field: 'startDate' },
  sortFields: ['startDate', 'endDate', 'createdAt', 'status', 'amount'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class CompanySubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { companyId: parseBigIntId(companyId), deletedAt: null },
      query,
      COMPANY_SUBSCRIPTIONS_LIST_FILTER,
    ) as Prisma.CompanySubscriptionWhereInput;

    return this.prisma.$transaction([
      this.prisma.companySubscription.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, COMPANY_SUBSCRIPTIONS_LIST_FILTER),
        include: { plan: true },
      }),
      this.prisma.companySubscription.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, companyId: string) {
    return this.prisma.companySubscription.findFirst({
      where: {
        companySubscriptionId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: { plan: true },
    });
  }

  findCurrent(companyId: string) {
    return this.prisma.companySubscription.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: { in: ['active', 'trial'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: {
          include: {
            planModules: { include: { module: true } },
          },
        },
      },
    });
  }

  findLatest(companyId: string) {
    return this.prisma.companySubscription.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: {
          include: {
            planModules: { include: { module: true } },
          },
        },
      },
    });
  }

  cancelActiveForCompany(companyId: string, updatedBy?: string) {
    return this.prisma.companySubscription.updateMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: { in: ['active', 'trial', 'pending'] },
      },
      data: {
        status: 'cancelled',
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  async findOrCreateCustomPlan() {
    const existing = await this.prisma.subscriptionPlan.findFirst({
      where: { planCode: 'CUSTOM', deletedAt: null },
    });
    if (existing) return existing;

    return this.prisma.subscriptionPlan.create({
      data: {
        planCode: 'CUSTOM',
        name: 'Custom Modules',
        description: 'Custom module set for a single company',
        price: 0,
        billingCycle: 'monthly',
        isActive: true,
      },
    });
  }

  async syncCompanyModules(
    companyId: string,
    moduleIds: string[],
    actorId?: string,
  ) {
    const companyBigInt = parseBigIntId(companyId);
    const actor = actorId ? parseBigIntId(actorId) : undefined;
    const uniqueIds = [...new Set(moduleIds)];

    const existing = await this.prisma.companyModule.findMany({
      where: { companyId: companyBigInt, deletedAt: null },
    });

    const keep = new Set(uniqueIds);
    for (const row of existing) {
      const id = row.moduleId.toString();
      if (!keep.has(id)) {
        await this.prisma.companyModule.update({
          where: { companyModuleId: row.companyModuleId },
          data: {
            isActive: false,
            deletedAt: new Date(),
            deletedBy: actor,
            updatedAt: new Date(),
          },
        });
      }
    }

    for (const moduleId of uniqueIds) {
      const found = existing.find((e) => e.moduleId.toString() === moduleId);
      if (found) {
        await this.prisma.companyModule.update({
          where: { companyModuleId: found.companyModuleId },
          data: {
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            updatedBy: actor,
            updatedAt: new Date(),
          },
        });
      } else {
        await this.prisma.companyModule.create({
          data: {
            companyId: companyBigInt,
            moduleId: parseBigIntId(moduleId),
            isActive: true,
            activatedDate: new Date(),
            createdBy: actor,
          },
        });
      }
    }
  }

  planExists(planId: string) {
    return this.prisma.subscriptionPlan.findFirst({
      where: { planId: parseBigIntId(planId), deletedAt: null },
    });
  }

  create(companyId: string, data: CreateCompanySubscriptionDto, createdBy?: string) {
    return this.prisma.companySubscription.create({
      data: {
        companyId: parseBigIntId(companyId),
        planId: parseBigIntId(data.planId, 'planId'),
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        billingCycle: data.billingCycle ?? 'monthly',
        amount: data.amount ?? 0,
        autoRenew: data.autoRenew ?? true,
        status: data.status ?? 'pending',
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
      include: { plan: true },
    });
  }

  update(id: string, dto: UpdateCompanySubscriptionDto, updatedBy?: string) {
    return this.prisma.companySubscription.update({
      where: { companySubscriptionId: parseBigIntId(id) },
      data: {
        ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate === null ? null : new Date(dto.endDate) }
          : {}),
        ...(dto.billingCycle !== undefined ? { billingCycle: dto.billingCycle } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.autoRenew !== undefined ? { autoRenew: dto.autoRenew } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
      include: { plan: true },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.companySubscription.update({
      where: { companySubscriptionId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        status: 'cancelled',
      },
    });
  }
}
