import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserLoginHistoryDto } from './dto/user-login-history.dto';
import { UserLoginHistoryRepository } from './user-login-history.repository';

@Injectable()
export class UserLoginHistoryService {
  constructor(
    private readonly repository: UserLoginHistoryRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const record = await this.repository.findById(id, userId);
    if (!record) throw new NotFoundException('User login history');
    return serialize(record);
  }

  async create(userId: string, companyId: string, dto: CreateUserLoginHistoryDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const record = await this.repository.create({
      userId,
      companyId: dto.companyId ?? companyId,
      loginDate: dto.loginDate ? new Date(dto.loginDate) : undefined,
      loginResult: dto.loginResult,
      failureReason: dto.failureReason,
      ipAddress: dto.ipAddress,
      browser: dto.browser,
      device: dto.device,
      country: dto.country,
      city: dto.city,
      sessionDuration: dto.sessionDuration,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserLoginHistory',
      entityId: record.loginHistoryId.toString(),
      newValue: { loginResult: record.loginResult },
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User login history');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserLoginHistory',
      entityId: id,
    });

    return { message: 'User login history deleted' };
  }
}
