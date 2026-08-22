import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { serialize } from '@/common/utils/bigint.util';
import { AddPlanModuleDto } from './dto/plan-module.dto';
import { PlanModulesRepository } from './plan-modules.repository';

@Injectable()
export class PlanModulesService {
  constructor(
    private readonly repository: PlanModulesRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(planId: string, query: PaginationQueryDto) {
    const plan = await this.repository.planExists(planId);
    if (!plan) throw new NotFoundException('Subscription plan');

    const result = await this.repository.findManyByPlan(planId, query);
    return { ...result, items: serialize(result.items) };
  }

  async findOne(planId: string, id: string) {
    const item = await this.repository.findById(id, planId);
    if (!item) throw new NotFoundException('Plan module');
    return serialize(item);
  }

  async create(planId: string, dto: AddPlanModuleDto, actorId?: string) {
    const plan = await this.repository.planExists(planId);
    if (!plan) throw new NotFoundException('Subscription plan');

    const mod = await this.repository.moduleExists(dto.moduleId);
    if (!mod) throw new NotFoundException('Module');

    if (mod.moduleType === 'admin') {
      throw new BusinessException('Admin modules cannot be assigned to subscription plans');
    }
    if (mod.lifecycleStatus !== 'AVAILABLE') {
      throw new BusinessException(
        `Only AVAILABLE product modules can be assigned to plans (${mod.moduleCode}: ${mod.lifecycleStatus})`,
      );
    }

    const existing = await this.repository.findByPlanAndModule(planId, dto.moduleId);
    if (existing) throw new ConflictException('Module already assigned to this plan');

    const planModule = await this.repository.create(planId, dto.moduleId);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'PlanModule',
      entityId: planModule.planModuleId.toString(),
      newValue: { planId, moduleId: dto.moduleId },
    });

    return serialize(planModule);
  }

  async remove(planId: string, id: string, actorId?: string) {
    const item = await this.repository.findById(id, planId);
    if (!item) throw new NotFoundException('Plan module');

    await this.repository.delete(id);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'PlanModule',
      entityId: id,
    });

    return { message: 'Module removed from plan' };
  }
}
