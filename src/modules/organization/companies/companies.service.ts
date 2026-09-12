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
import { companyCodeCandidates } from './company-code.util';
import { companyStatusSchema } from '@/common/zod/common.schemas';
import { z } from 'zod';

type CompanyStatus = z.infer<typeof companyStatusSchema>;

type CompanyWithSummary = NonNullable<Awaited<ReturnType<CompaniesRepository['findById']>>>;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly auditService: AuditService,
    private readonly systemRoleProvisioning: SystemRoleProvisioningService,
  ) {}

  private toCompanyPayload(company: CompanyWithSummary) {
    const subscription = company.subscriptions?.[0] ?? null;
    const activeModuleCount = company.companyModules?.filter((m) => m.isActive).length ?? 0;
    const entitledModuleCount = company.companyModules?.length ?? 0;

    const {
      subscriptions: _subs,
      companyModules: _mods,
      _count,
      ...rest
    } = company as CompanyWithSummary & {
      subscriptions?: unknown[];
      companyModules?: unknown[];
      _count?: { userCompanies: number };
    };

    return {
      ...rest,
      subscriptionStatus: subscription?.status ?? null,
      planCode: subscription?.plan?.planCode ?? null,
      planName: subscription?.plan?.name ?? null,
      subscriptionEndDate: subscription?.endDate ?? null,
      activeModuleCount,
      entitledModuleCount,
      userCount: _count?.userCompanies ?? 0,
    };
  }

  async findAll(query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findMany(query);
    const mapped = items.map((item) => this.toCompanyPayload(item as CompanyWithSummary));
    return serialize(toPaginatedResult(mapped, total, page, limit));
  }

  async findOne(id: string) {
    const company = await this.repository.findById(id);
    if (!company) throw new NotFoundException('Company');
    return serialize(this.toCompanyPayload(company));
  }

  async create(dto: CreateCompanyDto, actorId?: string) {
    const companyCode = await this.resolveCompanyCode(dto);
    const company = await this.repository.create({ ...dto, companyCode }, actorId);
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

    const created = await this.repository.findById(companyId);
    if (!created) throw new ConflictException('Failed to create company');
    return serialize(this.toCompanyPayload(created));
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

    const updated = await this.repository.findById(id);
    if (!updated) throw new NotFoundException('Company');
    return serialize(this.toCompanyPayload(updated));
  }

  async updateStatus(
    id: string,
    status: 'trial' | 'active' | 'suspended' | 'cancelled',
    actorId?: string,
  ) {
    return this.setStatus(id, status, actorId);
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

    const updated = await this.repository.findById(id);
    if (!updated) throw new NotFoundException('Company');
    return serialize(this.toCompanyPayload(updated));
  }

  private async resolveCompanyCode(dto: CreateCompanyDto): Promise<string> {
    const manual = dto.companyCode?.trim().toUpperCase();
    if (manual) {
      const existing = await this.repository.findByCode(manual);
      if (existing) throw new ConflictException('Company code already exists');
      return manual;
    }

    const nextSeq = await this.repository.nextAutoCompanySequence();
    for (const candidate of companyCodeCandidates(dto.name, nextSeq)) {
      const taken = await this.repository.findByCode(candidate);
      if (!taken) return candidate;
    }

    throw new ConflictException('Could not allocate a unique company code');
  }
}
