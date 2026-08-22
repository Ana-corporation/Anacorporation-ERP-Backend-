import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { SystemRoleProvisioningService } from '@/modules/iam/roles/system-role-provisioning.service';
import { CompaniesRepository } from './companies.repository';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { companyStatusSchema } from '@/common/zod/common.schemas';
import { z } from 'zod';

type CompanyStatus = z.infer<typeof companyStatusSchema>;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly auditService: AuditService,
    private readonly systemRoleProvisioning: SystemRoleProvisioningService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findMany(query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string) {
    return serialize(await this.repository.findPlatformCompanySummary(id));
  }

  async create(dto: CreateCompanyDto, actorId?: string) {
    const existing = await this.repository.findByCode(dto.companyCode);
    if (existing) throw new ConflictException('Company code already exists');

    const company = await this.repository.create(dto, actorId);
    const companyId = company.companyId.toString();

    // Core SYSTEM roles (ADMIN/MANAGER/STAFF). Module-gated templates (SALES, etc.)
    // are added when product modules are entitled — call provisionForCompany again with moduleCodes.
    await this.systemRoleProvisioning.provisionForCompany({
      companyId,
      moduleCodes: [],
      actorId,
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Company',
      entityId: companyId,
      newValue: { companyCode: company.companyCode, name: company.name },
    });

    return serialize(await this.repository.findPlatformCompanySummary(companyId));
  }

  async update(id: string, dto: UpdateCompanyDto, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Company');

    await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId: id,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Company',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(await this.repository.findPlatformCompanySummary(id));
  }

  async remove(id: string, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Company');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId: id,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Company',
      entityId: id,
    });

    return { message: 'Company deleted' };
  }

  /**
   * Phase A contract (FE):
   * PATCH /companies/:id/status → must return company + subscription summary
   * with module + user counts.
   */
  async setStatus(id: string, status: CompanyStatus, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Company');

    await this.repository.updateStatus(id, status, actorId);

    await this.auditService.log({
      companyId: id,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Company',
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status },
    });

    return serialize(await this.repository.findPlatformCompanySummary(id));
  }
}
