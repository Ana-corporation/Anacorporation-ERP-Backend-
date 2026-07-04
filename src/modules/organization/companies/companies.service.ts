import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CompaniesRepository } from './companies.repository';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findMany(query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string) {
    const company = await this.repository.findById(id);
    if (!company) throw new NotFoundException('Company');
    return serialize(company);
  }

  async create(dto: CreateCompanyDto, actorId?: string) {
    const existing = await this.repository.findByCode(dto.companyCode);
    if (existing) throw new ConflictException('Company code already exists');

    const company = await this.repository.create(dto, actorId);

    await this.auditService.log({
      companyId: company.companyId.toString(),
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Company',
      entityId: company.companyId.toString(),
      newValue: { companyCode: company.companyCode, name: company.name },
    });

    return serialize(company);
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

    return serialize(company);
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
