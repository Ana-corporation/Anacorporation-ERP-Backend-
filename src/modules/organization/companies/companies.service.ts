import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CompaniesRepository } from './companies.repository';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

type CompanyWithSummary = NonNullable<Awaited<ReturnType<CompaniesRepository['findById']>>>;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly auditService: AuditService,
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
    const existing = await this.repository.findByCode(dto.companyCode);
    if (existing) throw new ConflictException('Company code already exists');

    const company = await this.repository.create(dto, actorId);
    if (!company) throw new ConflictException('Failed to create company');

    await this.auditService.log({
      companyId: company.companyId.toString(),
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Company',
      entityId: company.companyId.toString(),
      newValue: { companyCode: company.companyCode, name: company.name },
    });

    return serialize(this.toCompanyPayload(company));
  }

  async update(id: string, dto: UpdateCompanyDto, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Company');

    const company = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId: id,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Company',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(this.toCompanyPayload(company));
  }

  async updateStatus(
    id: string,
    status: 'trial' | 'active' | 'suspended' | 'cancelled',
    actorId?: string,
  ) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Company');

    const company = await this.repository.updateStatus(id, status, actorId);

    await this.auditService.log({
      companyId: id,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Company',
      entityId: id,
      newValue: { status },
    });

    return serialize(this.toCompanyPayload(company));
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
}
