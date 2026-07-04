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
    if (existing) throw new ConflictException('Module already assigned to this company');

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
      newValue: { moduleId: dto.moduleId, isActive: companyModule.isActive },
    });

    return serialize(companyModule);
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
