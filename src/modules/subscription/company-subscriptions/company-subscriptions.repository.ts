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
        ...(dto.planId !== undefined ? { planId: parseBigIntId(dto.planId, 'planId') } : {}),
        ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate === null ? null : new Date(dto.endDate) }
          : {}),
        ...(dto.billingCycle !== undefined ? { billingCycle: dto.billingCycle } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.autoRenew !== undefined ? { autoRenew: dto.autoRenew } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.cancelAtPeriodEnd !== undefined
          ? {
              cancelAtPeriodEnd: dto.cancelAtPeriodEnd,
              cancelledAt: dto.cancelAtPeriodEnd ? new Date() : null,
            }
          : {}),
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
