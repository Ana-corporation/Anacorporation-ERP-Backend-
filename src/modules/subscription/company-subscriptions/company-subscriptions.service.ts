import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateCompanySubscriptionDto, UpdateCompanySubscriptionDto } from './dto/company-subscription.dto';
import { CompanySubscriptionsRepository } from './company-subscriptions.repository';

@Injectable()
export class CompanySubscriptionsService {
  constructor(
    private readonly repository: CompanySubscriptionsRepository,
    private readonly auditService: AuditService,
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

  async create(companyId: string, dto: CreateCompanySubscriptionDto, actorId: string) {
    const plan = await this.repository.planExists(dto.planId);
    if (!plan) throw new NotFoundException('Subscription plan');

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    this.validateDateRange(startDate, endDate);

    const subscription = await this.repository.create(companyId, dto, actorId);

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
