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
    const { moduleIds, ...planData } = dto;
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.create({
        data: {
          planCode: planData.planCode.trim().toUpperCase(),
          name: planData.name.trim(),
          description: planData.description,
          price: planData.price ?? 0,
          billingCycle: planData.billingCycle ?? 'monthly',
          maxUsers: planData.maxUsers,
          maxStorageGb: planData.maxStorageGb,
          isActive: planData.isActive ?? true,
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
      });

      if (moduleIds?.length) {
        await tx.planModule.createMany({
          data: moduleIds.map((moduleId) => ({
            planId: plan.planId,
            moduleId: parseBigIntId(moduleId),
          })),
          skipDuplicates: true,
        });
      }

      return tx.subscriptionPlan.findFirst({
        where: { planId: plan.planId },
        include: { planModules: { include: { module: true } } },
      });
    });
  }

  update(id: string, dto: UpdateSubscriptionPlanDto, updatedBy?: string) {
    const { moduleIds, ...planData } = dto;
    return this.prisma.$transaction(async (tx) => {
      await tx.subscriptionPlan.update({
        where: { planId: parseBigIntId(id) },
        data: {
          ...(planData.name !== undefined ? { name: planData.name.trim() } : {}),
          ...(planData.description !== undefined ? { description: planData.description } : {}),
          ...(planData.price !== undefined ? { price: planData.price } : {}),
          ...(planData.billingCycle !== undefined ? { billingCycle: planData.billingCycle } : {}),
          ...(planData.maxUsers !== undefined ? { maxUsers: planData.maxUsers } : {}),
          ...(planData.maxStorageGb !== undefined ? { maxStorageGb: planData.maxStorageGb } : {}),
          ...(planData.isActive !== undefined ? { isActive: planData.isActive } : {}),
          updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
          updatedAt: new Date(),
        },
      });

      if (moduleIds) {
        await tx.planModule.deleteMany({ where: { planId: parseBigIntId(id) } });
        if (moduleIds.length > 0) {
          await tx.planModule.createMany({
            data: moduleIds.map((moduleId) => ({
              planId: parseBigIntId(id),
              moduleId: parseBigIntId(moduleId),
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.subscriptionPlan.findFirst({
        where: { planId: parseBigIntId(id) },
        include: { planModules: { include: { module: true } } },
      });
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
