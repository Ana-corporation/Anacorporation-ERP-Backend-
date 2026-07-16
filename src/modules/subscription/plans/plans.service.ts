import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto } from './dto/plan.dto';
import { PlansRepository } from './plans.repository';

@Injectable()
export class PlansService {
  constructor(
    private readonly repository: PlansRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findMany(query);
    const mapped = items.map((plan) => ({
      ...plan,
      moduleIds: plan.planModules?.map((pm) => pm.moduleId.toString()) ?? [],
    }));
    return serialize(toPaginatedResult(mapped, total, page, limit));
  }

  async findOne(id: string) {
    const plan = await this.repository.findById(id);
    if (!plan) throw new NotFoundException('Subscription plan');
    return serialize({
      ...plan,
      moduleIds: plan.planModules?.map((pm) => pm.moduleId.toString()) ?? [],
    });
  }

  async create(dto: CreateSubscriptionPlanDto, actorId?: string) {
    const code = dto.planCode.trim().toUpperCase();
    const existing = await this.repository.findByCode(code);
    if (existing) throw new ConflictException('Plan code already exists');

    const plan = await this.repository.create({ ...dto, planCode: code }, actorId);
    if (!plan) throw new ConflictException('Failed to create plan');

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'SubscriptionPlan',
      entityId: plan.planId.toString(),
      newValue: { planCode: code, name: plan.name },
    });

    return serialize({
      ...plan,
      moduleIds: plan.planModules?.map((pm) => pm.moduleId.toString()) ?? [],
    });
  }

  async update(id: string, dto: UpdateSubscriptionPlanDto, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Subscription plan');

    const plan = await this.repository.update(id, dto, actorId);
    if (!plan) throw new NotFoundException('Subscription plan');

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'SubscriptionPlan',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize({
      ...plan,
      moduleIds: plan.planModules?.map((pm) => pm.moduleId.toString()) ?? [],
    });
  }

  async remove(id: string, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Subscription plan');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'SubscriptionPlan',
      entityId: id,
    });

    return { message: 'Subscription plan deleted' };
  }
}
