import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserDelegationDto, UpdateUserDelegationDto } from './dto/user-delegation.dto';
import { UserDelegationsRepository } from './user-delegations.repository';

@Injectable()
export class UserDelegationsService {
  constructor(
    private readonly repository: UserDelegationsRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  private validateDelegationUsers(userId: string, delegateUserId: string) {
    if (userId === delegateUserId) {
      throw new BusinessException('Delegator and delegate must be different users');
    }
  }

  private validateDateRange(startDate: Date, endDate?: Date | null) {
    if (endDate && endDate < startDate) {
      throw new BusinessException('endDate must be on or after startDate');
    }
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const delegation = await this.repository.findById(id, userId, companyId);
    if (!delegation) throw new NotFoundException('User delegation');
    return serialize(delegation);
  }

  async create(userId: string, companyId: string, dto: CreateUserDelegationDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    this.validateDelegationUsers(userId, dto.delegateUserId);
    await this.ensureUserInCompany(dto.delegateUserId, companyId);

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    this.validateDateRange(startDate, endDate);

    const record = await this.repository.create({
      userId,
      delegateUserId: dto.delegateUserId,
      companyId,
      startDate,
      endDate,
      reason: dto.reason,
      status: dto.status ?? 'active',
      createdBy: actorId,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserDelegation',
      entityId: record.delegationId.toString(),
      newValue: { delegateUserId: dto.delegateUserId, startDate: dto.startDate },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserDelegationDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('User delegation');

    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate =
      dto.endDate !== undefined ? (dto.endDate === null ? null : new Date(dto.endDate)) : existing.endDate;
    this.validateDateRange(startDate, endDate);

    const record = await this.repository.update(id, {
      ...(dto.startDate !== undefined ? { startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate } : {}),
      ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserDelegation',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('User delegation');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserDelegation',
      entityId: id,
    });

    return { message: 'User delegation deleted' };
  }
}
