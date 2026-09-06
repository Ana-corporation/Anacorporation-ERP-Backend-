import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { LIVE_SUBSCRIPTION_STATUSES, TENANT_VISIBLE_LIFECYCLES } from './entitlement.types';

@Injectable()
export class EntitlementRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCompany(companyId: string) {
    return this.prisma.company.findFirst({
      where: { companyId: parseBigIntId(companyId), deletedAt: null },
      select: { companyId: true, status: true },
    });
  }

  findLiveSubscription(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.companySubscription.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: { in: LIVE_SUBSCRIPTION_STATUSES },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: { plan: true },
      orderBy: { startDate: 'desc' },
    });
  }

  findPlanModuleIds(planId: bigint) {
    return this.prisma.planModule.findMany({
      where: { planId },
      select: { moduleId: true },
    });
  }

  findActiveOverrides(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.companyModuleOverride.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gte: today } }],
      },
      include: {
        module: {
          select: {
            moduleId: true,
            moduleCode: true,
            moduleName: true,
            moduleType: true,
            lifecycleStatus: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  findCompanyModuleSettings(companyId: string) {
    return this.prisma.companyModule.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      select: {
        moduleId: true,
        isEnabled: true,
        isActive: true,
        expiryDate: true,
      },
    });
  }

  findProductModulesByIds(moduleIds: bigint[]) {
    if (moduleIds.length === 0) return Promise.resolve([]);
    return this.prisma.module.findMany({
      where: {
        moduleId: { in: moduleIds },
        moduleType: 'product',
        deletedAt: null,
        isActive: true,
        lifecycleStatus: { in: [...TENANT_VISIBLE_LIFECYCLES] },
      },
      select: {
        moduleId: true,
        moduleCode: true,
        moduleName: true,
        lifecycleStatus: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  findAllTenantProductModules() {
    return this.prisma.module.findMany({
      where: {
        moduleType: 'product',
        deletedAt: null,
        isActive: true,
        lifecycleStatus: { in: [...TENANT_VISIBLE_LIFECYCLES] },
      },
      select: {
        moduleId: true,
        moduleCode: true,
        moduleName: true,
        lifecycleStatus: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  findModuleByCode(moduleCode: string) {
    return this.prisma.module.findFirst({
      where: {
        moduleCode,
        moduleType: 'product',
        deletedAt: null,
      },
    });
  }

  upsertCompanyModuleSetting(params: {
    companyId: string;
    moduleId: string;
    isEnabled: boolean;
    actorId?: string;
  }) {
    const companyId = parseBigIntId(params.companyId);
    const moduleId = parseBigIntId(params.moduleId);
    const actor = params.actorId ? parseBigIntId(params.actorId) : undefined;

    return this.prisma.companyModule.upsert({
      where: {
        companyId_moduleId: { companyId, moduleId },
      },
      create: {
        companyId,
        moduleId,
        isEnabled: params.isEnabled,
        isActive: params.isEnabled,
        createdBy: actor,
      },
      update: {
        isEnabled: params.isEnabled,
        isActive: params.isEnabled,
        deletedAt: null,
        deletedBy: null,
        updatedBy: actor,
        updatedAt: new Date(),
      },
    });
  }

  findCompanyUserIds(companyId: string) {
    return this.prisma.userCompany.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'active',
      },
      select: { userId: true },
    });
  }

  findActiveCompanyIdsByPlanId(planId: string) {
    return this.prisma.companySubscription.findMany({
      where: {
        planId: parseBigIntId(planId),
        deletedAt: null,
        status: { in: LIVE_SUBSCRIPTION_STATUSES },
      },
      select: { companyId: true },
      distinct: ['companyId'],
    });
  }

  findExpiredLiveSubscriptions(asOf: Date) {
    const day = new Date(asOf);
    day.setHours(0, 0, 0, 0);

    return this.prisma.companySubscription.findMany({
      where: {
        deletedAt: null,
        status: { in: LIVE_SUBSCRIPTION_STATUSES },
        endDate: { lt: day },
      },
      select: {
        companySubscriptionId: true,
        companyId: true,
      },
    });
  }
}
