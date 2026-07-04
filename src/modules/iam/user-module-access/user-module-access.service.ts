import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserModuleAccessDto, UpdateUserModuleAccessDto } from './dto/user-module-access.dto';
import { UserModuleAccessRepository } from './user-module-access.repository';

@Injectable()
export class UserModuleAccessService {
  constructor(
    private readonly repository: UserModuleAccessRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  private async ensureModuleExists(moduleId: string) {
    const module = await this.repository.findModuleById(moduleId);
    if (!module) throw new NotFoundException('Module');
    return module;
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const record = await this.repository.findById(id, userId, companyId);
    if (!record) throw new NotFoundException('User module access');
    return serialize(record);
  }

  async create(userId: string, companyId: string, dto: CreateUserModuleAccessDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    await this.ensureModuleExists(dto.moduleId);

    const existing = await this.repository.findByUserCompanyModule(userId, companyId, dto.moduleId);
    if (existing) throw new ConflictException('Module access already exists for this user and company');

    const record = await this.repository.create({
      userId,
      companyId,
      moduleId: dto.moduleId,
      accessType: dto.accessType ?? 'grant',
      reason: dto.reason,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      createdBy: actorId,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserModuleAccess',
      entityId: record.userModuleAccessId.toString(),
      newValue: { moduleId: dto.moduleId, accessType: record.accessType },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserModuleAccessDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('User module access');

    const record = await this.repository.update(id, {
      ...(dto.accessType !== undefined ? { accessType: dto.accessType } : {}),
      ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      ...(dto.expiryDate !== undefined
        ? { expiryDate: dto.expiryDate === null ? null : new Date(dto.expiryDate) }
        : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserModuleAccess',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('User module access');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserModuleAccess',
      entityId: id,
    });

    return { message: 'User module access deleted' };
  }
}
