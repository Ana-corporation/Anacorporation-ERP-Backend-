import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { BranchesRepository } from './branches.repository';

@Injectable()
export class BranchesService {
  constructor(
    private readonly repository: BranchesRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string, companyId: string) {
    const branch = await this.repository.findById(id, companyId);
    if (!branch) throw new NotFoundException('Branch');
    return serialize(branch);
  }

  async create(companyId: string, dto: CreateBranchDto, actorId: string) {
    const code = dto.branchCode.trim().toUpperCase();
    if (await this.repository.findByCode(companyId, code)) {
      throw new ConflictException('Branch code already exists');
    }

    const branch = await this.repository.create(companyId, { ...dto, branchCode: code }, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Branch',
      entityId: branch.branchId.toString(),
      newValue: { branchCode: code, name: branch.name },
    });

    return serialize(branch);
  }

  async update(id: string, companyId: string, dto: UpdateBranchDto, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) throw new NotFoundException('Branch');

    const branch = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Branch',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(branch);
  }

  async remove(id: string, companyId: string, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) throw new NotFoundException('Branch');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Branch',
      entityId: id,
    });

    return { message: 'Branch deleted' };
  }
}
