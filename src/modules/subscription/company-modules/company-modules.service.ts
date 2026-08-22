import { Injectable } from '@nestjs/common';
import { ModuleLifecycleStatus, ModuleType, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateCompanyModuleDto, UpdateCompanyModuleDto } from './dto/company-module.dto';
import { CompanyModulesRepository } from './company-modules.repository';
import { SystemRoleProvisioningService } from '@/modules/iam/roles/system-role-provisioning.service';

const GRANTABLE_LIFECYCLES: ModuleLifecycleStatus[] = ['AVAILABLE'];
const ACTIVATABLE_LIFECYCLES: ModuleLifecycleStatus[] = ['AVAILABLE', 'DEPRECATED'];

@Injectable()
export class CompanyModulesService {
  constructor(
    private readonly repository: CompanyModulesRepository,
    private readonly auditService: AuditService,
    private readonly systemRoleProvisioning: SystemRoleProvisioningService,
  ) {}

  private validateDateRange(activatedDate: Date, expiryDate?: Date | null) {
    if (expiryDate && expiryDate < activatedDate) {
      throw new BusinessException('expiryDate must be on or after activatedDate');
    }
  }

  private assertModuleGrantable(
    mod: {
      moduleType: ModuleType;
      lifecycleStatus: ModuleLifecycleStatus;
      moduleCode: string;
    },
    opts: { forNewGrant: boolean; activating: boolean },
  ) {
    if (mod.moduleType === 'admin') {
      throw new BusinessException(
        'Admin modules cannot be granted as customer workspace entitlements',
      );
    }

    if (mod.lifecycleStatus === 'DISABLED') {
      throw new BusinessException('Module is disabled and cannot be entitled');
    }

    if (opts.forNewGrant && !GRANTABLE_LIFECYCLES.includes(mod.lifecycleStatus)) {
      throw new BusinessException(
        `Module is not available for customer entitlement (${mod.moduleCode}: ${mod.lifecycleStatus})`,
      );
    }

    if (opts.activating && !ACTIVATABLE_LIFECYCLES.includes(mod.lifecycleStatus)) {
      throw new BusinessException(
        `Module cannot be activated while lifecycle is ${mod.lifecycleStatus}`,
      );
    }
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
    );
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const companyModule = await this.repository.findById(id, companyId);
    if (!companyModule) throw new NotFoundException('Company module');
    return serialize(companyModule);
  }

  async create(companyId: string, dto: CreateCompanyModuleDto, actorId: string) {
    const mod = await this.repository.moduleExists(dto.moduleId);
    if (!mod) throw new NotFoundException('Module');

    this.assertModuleGrantable(mod, {
      forNewGrant: true,
      activating: dto.isActive !== false,
    });

    const existing = await this.repository.findByCompanyAndModule(companyId, dto.moduleId);
    if (existing && !existing.deletedAt) {
      throw new ConflictException('Module already assigned to this company');
    }

    const activatedDate = dto.activatedDate ? new Date(dto.activatedDate) : new Date();
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : undefined;
    this.validateDateRange(activatedDate, expiryDate);

    const companyModule = await this.repository.create(companyId, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'CompanyModule',
      entityId: companyModule.companyModuleId.toString(),
      newValue: {
        moduleId: dto.moduleId,
        moduleCode: mod.moduleCode,
        isActive: companyModule.isActive,
      },
    });

    if (companyModule.isActive) {
      await this.systemRoleProvisioning.provisionFromCompanyEntitlements(companyId, actorId);
    }

    return serialize(companyModule);
  }

  async update(id: string, companyId: string, dto: UpdateCompanyModuleDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Company module');

    if (dto.isActive === true) {
      this.assertModuleGrantable(existing.module, {
        forNewGrant: false,
        activating: true,
      });
    }

    const activatedDate = dto.activatedDate ? new Date(dto.activatedDate) : existing.activatedDate;
    const expiryDate =
      dto.expiryDate !== undefined
        ? dto.expiryDate === null
          ? null
          : new Date(dto.expiryDate)
        : existing.expiryDate;
    this.validateDateRange(activatedDate, expiryDate);

    const companyModule = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanyModule',
      entityId: id,
      newValue: {
        ...(dto as Record<string, unknown>),
        moduleCode: existing.module.moduleCode,
      },
    });

    if (dto.isActive === true) {
      await this.systemRoleProvisioning.provisionFromCompanyEntitlements(companyId, actorId);
    }

    return serialize(companyModule);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Company module');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'CompanyModule',
      entityId: id,
      newValue: {
        moduleId: existing.moduleId.toString(),
        moduleCode: existing.module.moduleCode,
        isActive: false,
      },
    });

    return { message: 'Company module deleted' };
  }
}
