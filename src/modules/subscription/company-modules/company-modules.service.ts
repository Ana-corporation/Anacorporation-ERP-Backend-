import { HttpStatus, Injectable } from '@nestjs/common';
import { ModuleLifecycleStatus, ModuleType, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { ENTITLEMENT_ERROR_CODES } from '@/common/constants/entitlement.constants';
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
import { UserContextCacheService } from '@/modules/iam/authentication/user-context-cache.service';
import { EntitlementService } from '@/modules/subscription/entitlements/entitlement.service';

const GRANTABLE_LIFECYCLES: ModuleLifecycleStatus[] = ['AVAILABLE'];
const ACTIVATABLE_LIFECYCLES: ModuleLifecycleStatus[] = ['AVAILABLE', 'DEPRECATED'];

@Injectable()
export class CompanyModulesService {
  constructor(
    private readonly repository: CompanyModulesRepository,
    private readonly auditService: AuditService,
    private readonly systemRoleProvisioning: SystemRoleProvisioningService,
    private readonly entitlementService: EntitlementService,
    private readonly userContextCache: UserContextCacheService,
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

  private flatten(row: {
    companyModuleId: bigint;
    companyId: bigint;
    moduleId: bigint;
    isActive: boolean;
    expiryDate: Date | null;
    module?: { moduleCode: string; moduleName: string } | null;
  }) {
    return {
      companyModuleId: row.companyModuleId.toString(),
      companyId: row.companyId.toString(),
      moduleId: row.moduleId.toString(),
      moduleCode: row.module?.moduleCode ?? null,
      moduleName: row.module?.moduleName ?? null,
      isActive: row.isActive,
      expiryDate: row.expiryDate,
    };
  }

  async findAllFlat(companyId: string, query: PaginationQueryDto) {
    const { items } = await this.repository.findManyByCompany(companyId, {
      ...query,
      page: query.page ?? 1,
      limit: query.limit ?? 200,
    });
    return serialize(items.map((row) => this.flatten(row)));
  }

  async findOneFlexible(id: string, companyId: string) {
    const byRow = await this.repository.findById(id, companyId);
    if (byRow) return serialize(this.flatten(byRow));

    const byModule = await this.repository.findByCompanyAndModule(companyId, id);
    if (!byModule || byModule.deletedAt) throw new NotFoundException('Company module');
    const full = await this.repository.findById(byModule.companyModuleId.toString(), companyId);
    if (!full) throw new NotFoundException('Company module');
    return serialize(this.flatten(full));
  }

  private async resolveRow(id: string, companyId: string) {
    const byRow = await this.repository.findById(id, companyId);
    if (byRow) return byRow;

    const byModule = await this.repository.findByCompanyAndModule(companyId, id);
    if (!byModule || byModule.deletedAt) return null;
    return this.repository.findById(byModule.companyModuleId.toString(), companyId);
  }

  async updateFlexible(
    id: string,
    companyId: string,
    dto: UpdateCompanyModuleDto,
    actorId: string,
  ) {
    const existing = await this.resolveRow(id, companyId);
    if (!existing) throw new NotFoundException('Company module');

    const activatedDate = dto.activatedDate ? new Date(dto.activatedDate) : existing.activatedDate;
    const expiryDate =
      dto.expiryDate !== undefined
        ? dto.expiryDate === null
          ? null
          : new Date(dto.expiryDate)
        : existing.expiryDate;
    this.validateDateRange(activatedDate, expiryDate);

    const companyModule = await this.repository.update(
      existing.companyModuleId.toString(),
      dto,
      actorId,
    );

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanyModule',
      entityId: existing.companyModuleId.toString(),
      newValue: dto as Record<string, unknown>,
    });

    return serialize(this.flatten(companyModule));
  }

  async removeFlexible(id: string, companyId: string, actorId: string) {
    const existing = await this.resolveRow(id, companyId);
    if (!existing) throw new NotFoundException('Company module');

    await this.repository.softDelete(existing.companyModuleId.toString(), actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'CompanyModule',
      entityId: existing.companyModuleId.toString(),
    });

    return { message: 'Company module deleted' };
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

    let companyModule;
    if (existing?.deletedAt) {
      companyModule = await this.repository.update(
        existing.companyModuleId.toString(),
        {
          isActive: dto.isActive ?? true,
          activatedDate: dto.activatedDate,
          expiryDate: dto.expiryDate,
        },
        actorId,
      );
      await this.repository['prisma'].companyModule.update({
        where: { companyModuleId: existing.companyModuleId },
        data: { deletedAt: null, deletedBy: null },
      });
      companyModule = await this.repository.findById(existing.companyModuleId.toString(), companyId);
    } else {
      companyModule = await this.repository.create(companyId, dto, actorId);
    }

    if (!companyModule) throw new NotFoundException('Company module');

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

    await this.userContextCache.invalidateCompany(companyId);

    if (companyModule.isActive) {
      await this.systemRoleProvisioning.provisionFromCompanyEntitlements(companyId, actorId);
    }

    return serialize(this.flatten(companyModule));
  }

  async setModuleEnabled(
    companyId: string,
    moduleId: string,
    enabled: boolean,
    actorId: string,
  ) {
    const result = await this.entitlementService.setModuleEnabled({
      companyId,
      moduleId,
      enabled,
      actorId,
    });

    if (!result.ok) {
      throw new BusinessException(
        'Module is not included in the company subscription.',
        HttpStatus.FORBIDDEN,
        [{ field: 'enabled', message: 'Module is not commercially entitled' }],
        ENTITLEMENT_ERROR_CODES.MODULE_NOT_ENTITLED,
      );
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanyModuleSetting',
      entityId: moduleId,
      newValue: { enabled },
    });

    await this.userContextCache.invalidateCompany(companyId);
    return { moduleId, enabled };
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

    await this.userContextCache.invalidateCompany(companyId);
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

    await this.userContextCache.invalidateCompany(companyId);
    return { message: 'Company module deleted' };
  }
}
