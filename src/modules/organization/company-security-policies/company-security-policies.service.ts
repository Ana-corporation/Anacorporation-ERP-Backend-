import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateCompanySecurityPolicyDto, UpdateCompanySecurityPolicyDto } from './dto/company-security-policy.dto';
import { CompanySecurityPoliciesRepository } from './company-security-policies.repository';

@Injectable()
export class CompanySecurityPoliciesService {
  constructor(
    private readonly repository: CompanySecurityPoliciesRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const policy = await this.repository.findById(id, companyId);
    if (!policy) throw new NotFoundException('Company security policy');
    return serialize(policy);
  }

  async create(companyId: string, dto: CreateCompanySecurityPolicyDto, actorId: string) {
    const existing = await this.repository.findByCompanyId(companyId);
    if (existing) throw new ConflictException('Security policy already exists for this company');

    const policy = await this.repository.create(companyId, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'CompanySecurityPolicy',
      entityId: policy.policyId.toString(),
      newValue: { licenseType: policy.licenseType, requireMfa: policy.requireMfa },
    });

    return serialize(policy);
  }

  async update(id: string, companyId: string, dto: UpdateCompanySecurityPolicyDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Company security policy');

    const policy = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanySecurityPolicy',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(policy);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Company security policy');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'CompanySecurityPolicy',
      entityId: id,
    });

    return { message: 'Company security policy deleted' };
  }
}
