import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';

const PLAN_MODULES_LIST_FILTER: ListFilterOptions = {
  exact: { moduleId: 'moduleId' },
  dateRange: { field: 'createdAt' },
  sortFields: ['createdAt', 'moduleId', 'planModuleId'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class PlanModulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByPlan(planId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const where = buildListWhere(
      { planId: parseBigIntId(planId) },
      query,
      PLAN_MODULES_LIST_FILTER,
    ) as Prisma.PlanModuleWhereInput;

    return this.prisma.$transaction([
      this.prisma.planModule.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, PLAN_MODULES_LIST_FILTER),
        include: { module: true },
      }),
      this.prisma.planModule.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string, planId: string) {
    return this.prisma.planModule.findFirst({
      where: {
        planModuleId: parseBigIntId(id),
        planId: parseBigIntId(planId),
      },
      include: { module: true, plan: true },
    });
  }

  findByPlanAndModule(planId: string, moduleId: string) {
    return this.prisma.planModule.findFirst({
      where: {
        planId: parseBigIntId(planId),
        moduleId: parseBigIntId(moduleId),
      },
    });
  }

  create(planId: string, moduleId: string) {
    return this.prisma.planModule.create({
      data: {
        planId: parseBigIntId(planId),
        moduleId: parseBigIntId(moduleId),
      },
      include: { module: true },
    });
  }

  delete(id: string) {
    return this.prisma.planModule.delete({
      where: { planModuleId: parseBigIntId(id) },
    });
  }

  planExists(planId: string) {
    return this.prisma.subscriptionPlan.findFirst({
      where: { planId: parseBigIntId(planId), deletedAt: null },
    });
  }

  moduleExists(moduleId: string) {
    return this.prisma.module.findFirst({
      where: { moduleId: parseBigIntId(moduleId), deletedAt: null },
    });
  }
}
