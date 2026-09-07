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
import { UserContextCacheService } from '@/modules/iam/authentication/user-context-cache.service';
import { EntitlementRepository } from '@/modules/subscription/entitlements/entitlement.repository';
import { EntitlementService } from '@/modules/subscription/entitlements/entitlement.service';
import { AddPlanModuleDto, ReplacePlanModulesDto } from './dto/plan-module.dto';
import { PlanModulesRepository } from './plan-modules.repository';

@Injectable()
export class PlanModulesService {
  constructor(
    private readonly repository: PlanModulesRepository,
    private readonly entitlementRepository: EntitlementRepository,
    private readonly entitlementService: EntitlementService,
    private readonly auditService: AuditService,
    private readonly userContextCache: UserContextCacheService,
  ) {}

  private async refreshCompaniesOnPlan(planId: string, actorId?: string) {
    const rows = await this.entitlementRepository.findActiveCompanyIdsByPlanId(planId);
    await Promise.all(
      rows.map(async (row) => {
        const companyId = row.companyId.toString();
        await this.entitlementService.ensureDefaultSettingsForPlan(companyId, actorId);
        await this.userContextCache.invalidateCompany(companyId);
      }),
    );
  }

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

    await this.refreshCompaniesOnPlan(planId, actorId);

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

    await this.refreshCompaniesOnPlan(planId, actorId);

    return { message: 'Module removed from plan' };
  }

  async replaceAll(planId: string, dto: ReplacePlanModulesDto, actorId?: string) {
    const plan = await this.repository.planExists(planId);
    if (!plan) throw new NotFoundException('Subscription plan');

    const codes = [...new Set(dto.moduleCodes.map((c) => c.trim().toLowerCase()))];
    const modules = await this.repository.findModulesByCodes(codes);

    if (codes.length !== modules.length) {
      const found = new Set(modules.map((m) => m.moduleCode.toLowerCase()));
      const missing = codes.filter((c) => !found.has(c));
      throw new NotFoundException(`Module(s): ${missing.join(', ')}`);
    }

    for (const mod of modules) {
      if (mod.moduleType === 'admin') {
        throw new BusinessException('Admin modules cannot be assigned to subscription plans');
      }
      if (mod.lifecycleStatus !== 'AVAILABLE' && mod.lifecycleStatus !== 'DEPRECATED') {
        throw new BusinessException(
          `Module is not assignable to plans (${mod.moduleCode}: ${mod.lifecycleStatus})`,
        );
      }
    }

    await this.repository.deleteAllByPlan(planId);
    for (const mod of modules) {
      await this.repository.create(planId, mod.moduleId.toString());
    }

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'PlanModule',
      entityId: planId,
      newValue: { moduleCodes: codes },
    });

    await this.refreshCompaniesOnPlan(planId, actorId);

    const result = await this.repository.findManyByPlan(planId, {
      page: 1,
      limit: 100,
    } as PaginationQueryDto);
    return serialize(result.items);
  }
}
