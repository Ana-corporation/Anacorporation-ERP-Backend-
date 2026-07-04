import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto } from './dto/plan.dto';

const PLANS_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'planCode', name: 'name' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['planCode', 'name', 'description'],
  sortFields: ['planCode', 'name', 'price', 'billingCycle', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere({ deletedAt: null }, query, PLANS_LIST_FILTER) as Prisma.SubscriptionPlanWhereInput;

    return this.prisma.$transaction([
      this.prisma.subscriptionPlan.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, PLANS_LIST_FILTER),
        include: {
          planModules: { include: { module: true } },
        },
      }),
      this.prisma.subscriptionPlan.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.subscriptionPlan.findFirst({
      where: { planId: parseBigIntId(id), deletedAt: null },
      include: {
        planModules: { include: { module: true } },
        subscriptions: { where: { deletedAt: null }, take: 10 },
      },
    });
  }

  findByCode(planCode: string) {
    return this.prisma.subscriptionPlan.findFirst({
      where: { planCode, deletedAt: null },
    });
  }

  create(dto: CreateSubscriptionPlanDto, createdBy?: string) {
    return this.prisma.subscriptionPlan.create({
      data: {
        planCode: dto.planCode.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description,
        price: dto.price ?? 0,
        billingCycle: dto.billingCycle ?? 'monthly',
        maxUsers: dto.maxUsers,
        maxStorageGb: dto.maxStorageGb,
        isActive: dto.isActive ?? true,
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateSubscriptionPlanDto, updatedBy?: string) {
    return this.prisma.subscriptionPlan.update({
      where: { planId: parseBigIntId(id) },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.billingCycle !== undefined ? { billingCycle: dto.billingCycle } : {}),
        ...(dto.maxUsers !== undefined ? { maxUsers: dto.maxUsers } : {}),
        ...(dto.maxStorageGb !== undefined ? { maxStorageGb: dto.maxStorageGb } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.subscriptionPlan.update({
      where: { planId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }
}
