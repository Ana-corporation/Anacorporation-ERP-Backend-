import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { UserContextCacheService } from '@/modules/iam/authentication/user-context-cache.service';
import { EntitlementService } from '@/modules/subscription/entitlements/entitlement.service';
import { EntitlementRepository } from '@/modules/subscription/entitlements/entitlement.repository';
import {
  CreateCompanySubscriptionDto,
  PatchCurrentSubscriptionDto,
  UpdateCompanySubscriptionDto,
} from './dto/company-subscription.dto';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository';

@Injectable()
export class CompanySubscriptionsService {
  constructor(
    private readonly repository: CompanySubscriptionsRepository,
    private readonly entitlementRepository: EntitlementRepository,
    private readonly entitlementService: EntitlementService,
    private readonly auditService: AuditService,
    private readonly userContextCache: UserContextCacheService,
  ) {}

  private validateDateRange(startDate: Date, endDate?: Date | null) {
    if (endDate && endDate < startDate) {
      throw new BusinessException('endDate must be on or after startDate');
    }
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

  async findCurrent(companyId: string) {
    const subscription = await this.entitlementRepository.findLiveSubscription(companyId);
    if (!subscription) {
      return serialize({ status: 'none', plan: null });
    }
    return serialize({
      plan: {
        code: subscription.plan.planCode,
        name: subscription.plan.name,
        planId: subscription.planId.toString(),
      },
      status: subscription.status,
      startDate: subscription.startDate.toISOString().slice(0, 10),
      endDate: subscription.endDate?.toISOString().slice(0, 10) ?? null,
      billingCycle: subscription.billingCycle,
      autoRenew: subscription.autoRenew,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
    });
  }

  async create(companyId: string, dto: CreateCompanySubscriptionDto, actorId: string) {
    const plan = await this.repository.planExists(dto.planId);
    if (!plan) throw new NotFoundException('Subscription plan');
    if (!plan.isActive) {
      throw new BusinessException('Subscription plan is not active');
    }

    const live = await this.entitlementRepository.findLiveSubscription(companyId);
    if (live) {
      await this.repository.update(
        live.companySubscriptionId.toString(),
        { status: 'expired' },
        actorId,
      );
      await this.auditService.log({
        companyId,
        performedBy: actorId,
        action: UserAuditAction.update,
        entityName: 'CompanySubscription',
        entityId: live.companySubscriptionId.toString(),
        newValue: { status: 'expired', reason: 'replaced by new subscription' },
      });
    }

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    this.validateDateRange(startDate, endDate);

    const subscription = await this.repository.create(companyId, dto, actorId);
    await this.entitlementService.ensureDefaultSettingsForPlan(companyId, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'CompanySubscription',
      entityId: subscription.companySubscriptionId.toString(),
      newValue: { planId: dto.planId, startDate: dto.startDate, status: subscription.status },
    });

    await this.userContextCache.invalidateCompany(companyId);
    return serialize(subscription);
  }

  async patchCurrent(companyId: string, dto: PatchCurrentSubscriptionDto, actorId: string) {
    const live = await this.entitlementRepository.findLiveSubscription(companyId);
    if (!live) throw new NotFoundException('Company subscription');

    const subscription = await this.repository.update(
      live.companySubscriptionId.toString(),
      dto as UpdateCompanySubscriptionDto,
      actorId,
    );

    if (dto.planId) {
      await this.entitlementService.ensureDefaultSettingsForPlan(companyId, actorId);
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanySubscription',
      entityId: live.companySubscriptionId.toString(),
      newValue: dto as Record<string, unknown>,
    });

    await this.userContextCache.invalidateCompany(companyId);
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

    await this.userContextCache.invalidateCompany(companyId);
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

    await this.userContextCache.invalidateCompany(companyId);
    return { message: 'Company subscription deleted' };
  }
}
