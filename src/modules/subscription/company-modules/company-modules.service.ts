import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { BusinessException, ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateCompanyModuleDto, UpdateCompanyModuleDto } from './dto/company-module.dto';
import { CompanyModulesRepository } from './company-modules.repository';

@Injectable()
export class CompanyModulesService {
  constructor(
    private readonly repository: CompanyModulesRepository,
    private readonly auditService: AuditService,
  ) {}

  private validateDateRange(activatedDate: Date, expiryDate?: Date | null) {
    if (expiryDate && expiryDate < activatedDate) {
      throw new BusinessException('expiryDate must be on or after activatedDate');
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
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
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
      newValue: { moduleId: dto.moduleId, isActive: companyModule.isActive },
    });

    return serialize(this.flatten(companyModule));
  }

  async update(id: string, companyId: string, dto: UpdateCompanyModuleDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Company module');

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
      newValue: dto as Record<string, unknown>,
    });

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
    });

    return { message: 'Company module deleted' };
  }
}
