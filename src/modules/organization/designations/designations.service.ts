import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';
import { DesignationsRepository } from './designations.repository';

@Injectable()
export class DesignationsService {
  constructor(
    private readonly repository: DesignationsRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const designation = await this.repository.findById(id, companyId);
    if (!designation) throw new NotFoundException('Designation');
    return serialize(designation);
  }

  async create(companyId: string, dto: CreateDesignationDto, actorId: string) {
    const code = dto.designationCode.trim().toUpperCase();
    const existing = await this.repository.findByCode(companyId, code);
    if (existing) throw new ConflictException('Designation code already exists');

    const designation = await this.repository.create(companyId, { ...dto, designationCode: code }, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Designation',
      entityId: designation.designationId.toString(),
      newValue: { designationCode: code, name: designation.name },
    });

    return serialize(designation);
  }

  async update(id: string, companyId: string, dto: UpdateDesignationDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Designation');

    const designation = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Designation',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(designation);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Designation');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Designation',
      entityId: id,
    });

    return { message: 'Designation deleted' };
  }
}
