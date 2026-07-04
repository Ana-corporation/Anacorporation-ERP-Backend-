import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserMfaDto, UpdateUserMfaDto } from './dto/user-mfa.dto';
import { UserMfaRepository } from './user-mfa.repository';

@Injectable()
export class UserMfaService {
  constructor(
    private readonly repository: UserMfaRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const record = await this.repository.findById(id, userId);
    if (!record) throw new NotFoundException('User MFA');
    return serialize(record);
  }

  async create(userId: string, companyId: string, dto: CreateUserMfaDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const record = await this.repository.create({
      userId,
      mfaType: dto.mfaType,
      secret: dto.secret,
      phone: dto.phone,
      email: dto.email,
      isPrimary: dto.isPrimary ?? false,
      isEnabled: dto.isEnabled ?? true,
      verifiedAt: dto.verifiedAt ? new Date(dto.verifiedAt) : undefined,
      recoveryCodes: dto.recoveryCodes,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserMfa',
      entityId: record.userMfaId.toString(),
      newValue: { mfaType: record.mfaType, isEnabled: record.isEnabled },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserMfaDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User MFA');

    const record = await this.repository.update(id, {
      ...(dto.secret !== undefined ? { secret: dto.secret } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
      ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
      ...(dto.verifiedAt !== undefined
        ? { verifiedAt: dto.verifiedAt === null ? null : new Date(dto.verifiedAt) }
        : {}),
      ...(dto.recoveryCodes !== undefined ? { recoveryCodes: dto.recoveryCodes } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserMfa',
      entityId: id,
      newValue: { isPrimary: dto.isPrimary, isEnabled: dto.isEnabled },
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User MFA');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserMfa',
      entityId: id,
    });

    return { message: 'User MFA deleted' };
  }
}
