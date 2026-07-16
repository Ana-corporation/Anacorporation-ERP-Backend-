import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize, parseBigIntId } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  AssignCompanySubscriptionDto,
  CreateCompanySubscriptionDto,
  UpdateCompanySubscriptionDto,
} from './dto/company-subscription.dto';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository';

@Injectable()
export class CompanySubscriptionsService {
  constructor(
    private readonly repository: CompanySubscriptionsRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private validateDateRange(startDate: Date, endDate?: Date | null) {
    if (endDate && endDate < startDate) {
      throw new BusinessException('endDate must be on or after startDate');
    }
  }

  private toSubscriptionPayload(
    subscription: {
      companySubscriptionId: bigint;
      companyId: bigint;
      planId: bigint;
      startDate: Date;
      endDate: Date | null;
      billingCycle: string;
      amount: unknown;
      autoRenew: boolean;
      status: string;
      plan?: { planCode: string; name: string; planModules?: { moduleId: bigint }[] } | null;
    },
    isCustom: boolean,
    moduleIds: string[],
  ) {
    return {
      companySubscriptionId: subscription.companySubscriptionId.toString(),
      companyId: subscription.companyId.toString(),
      planId: subscription.planId.toString(),
      planCode: subscription.plan?.planCode ?? null,
      planName: subscription.plan?.name ?? null,
      isCustom,
      moduleIds,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      billingCycle: subscription.billingCycle,
      amount: subscription.amount,
      autoRenew: subscription.autoRenew,
      status: subscription.status,
    };
  }

  async getCurrent(companyId: string) {
    const subscription =
      (await this.repository.findCurrent(companyId)) ??
      (await this.repository.findLatest(companyId));
    if (!subscription) return null;

    const companyModules = await this.prisma.companyModule.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        isActive: true,
      },
    });
    const moduleIds = companyModules.map((m) => m.moduleId.toString());
    const isCustom = subscription.plan?.planCode === 'CUSTOM';

    return serialize(this.toSubscriptionPayload(subscription, isCustom, moduleIds));
  }

  async assignOrReplace(companyId: string, dto: AssignCompanySubscriptionDto, actorId: string) {
    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    this.validateDateRange(startDate, endDate);

    let planId = dto.planId ?? undefined;
    let moduleIds = dto.moduleIds ?? [];
    const isCustom = Boolean(dto.isCustom);

    if (isCustom) {
      const customPlan = await this.repository.findOrCreateCustomPlan();
      planId = customPlan.planId.toString();
      moduleIds = dto.moduleIds ?? [];
    } else {
      if (!planId) throw new NotFoundException('Subscription plan');
      const plan = await this.prisma.subscriptionPlan.findFirst({
        where: { planId: parseBigIntId(planId), deletedAt: null },
        include: { planModules: true },
      });
      if (!plan) throw new NotFoundException('Subscription plan');
      moduleIds = plan.planModules.map((pm) => pm.moduleId.toString());
    }

    await this.repository.cancelActiveForCompany(companyId, actorId);

    const subscription = await this.repository.create(
      companyId,
      {
        planId: planId!,
        startDate: dto.startDate,
        endDate: dto.endDate,
        billingCycle: dto.billingCycle ?? 'monthly',
        amount: dto.amount ?? 0,
        autoRenew: dto.autoRenew ?? true,
        status: dto.status ?? 'trial',
      },
      actorId,
    );

    await this.repository.syncCompanyModules(companyId, moduleIds, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'CompanySubscription',
      entityId: subscription.companySubscriptionId.toString(),
      newValue: { planId, isCustom, status: subscription.status, moduleIds },
    });

    const loaded = await this.repository.findById(
      subscription.companySubscriptionId.toString(),
      companyId,
    );
    if (!loaded) throw new NotFoundException('Company subscription');

    return serialize(this.toSubscriptionPayload(loaded, isCustom, moduleIds));
  }

  async cancelCurrent(companyId: string, actorId: string, reason?: string) {
    const current = await this.repository.findCurrent(companyId);
    if (!current) throw new NotFoundException('Active subscription');

    await this.repository.softDelete(current.companySubscriptionId.toString(), actorId);
    await this.repository.syncCompanyModules(companyId, [], actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanySubscription',
      entityId: current.companySubscriptionId.toString(),
      newValue: { status: 'cancelled', reason },
    });

    return { message: 'Subscription cancelled', reason: reason ?? null };
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const subscription = await this.repository.findById(id, companyId);
    if (!subscription) throw new NotFoundException('Company subscription');
    return serialize(subscription);
  }

  async create(companyId: string, dto: CreateCompanySubscriptionDto, actorId: string) {
    const plan = await this.repository.planExists(dto.planId);
    if (!plan) throw new NotFoundException('Subscription plan');

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    this.validateDateRange(startDate, endDate);

    const subscription = await this.repository.create(companyId, dto, actorId);

    const planRecord = await this.prisma.subscriptionPlan.findFirst({
      where: { planId: parseBigIntId(dto.planId), deletedAt: null },
      include: { planModules: true },
    });
    const moduleIds = planRecord?.planModules.map((pm) => pm.moduleId.toString()) ?? [];
    await this.repository.syncCompanyModules(companyId, moduleIds, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'CompanySubscription',
      entityId: subscription.companySubscriptionId.toString(),
      newValue: { planId: dto.planId, startDate: dto.startDate, status: subscription.status },
    });

    return serialize(subscription);
  }

  async update(id: string, companyId: string, dto: UpdateCompanySubscriptionDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Company subscription');

    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate =
      dto.endDate !== undefined ? (dto.endDate === null ? null : new Date(dto.endDate)) : existing.endDate;
    this.validateDateRange(startDate, endDate);

    const subscription = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanySubscription',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(subscription);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Company subscription');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'CompanySubscription',
      entityId: id,
    });

    return { message: 'Company subscription deleted' };
  }
}
