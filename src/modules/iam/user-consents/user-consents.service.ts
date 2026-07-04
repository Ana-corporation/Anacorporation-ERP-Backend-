import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserConsentDto, UpdateUserConsentDto } from './dto/user-consent.dto';
import { UserConsentsRepository } from './user-consents.repository';

@Injectable()
export class UserConsentsService {
  constructor(
    private readonly repository: UserConsentsRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  private resolveAcceptedDate(isAccepted: boolean, acceptedDate?: string | null) {
    if (!isAccepted) return null;
    return acceptedDate ? new Date(acceptedDate) : new Date();
  }

  async findAll(userId: string, companyId: string, query: PaginationQueryDto) {
    await this.ensureUserInCompany(userId, companyId);
    const { items, total, page, limit } = await this.repository.findManyByUser(userId, companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(userId: string, companyId: string, id: string) {
    await this.ensureUserInCompany(userId, companyId);
    const consent = await this.repository.findById(id, userId, companyId);
    if (!consent) throw new NotFoundException('User consent');
    return serialize(consent);
  }

  async create(userId: string, companyId: string, dto: CreateUserConsentDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const isAccepted = dto.isAccepted ?? false;
    const record = await this.repository.create({
      userId,
      companyId,
      consentType: dto.consentType,
      consentVersion: dto.consentVersion,
      isAccepted,
      acceptedDate: this.resolveAcceptedDate(isAccepted, dto.acceptedDate),
      ipAddress: dto.ipAddress,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserConsent',
      entityId: record.consentId.toString(),
      newValue: { consentType: record.consentType, consentVersion: record.consentVersion },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserConsentDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('User consent');

    let acceptedDate: Date | null | undefined;
    if (dto.acceptedDate !== undefined) {
      acceptedDate = dto.acceptedDate === null ? null : new Date(dto.acceptedDate);
    } else if (dto.isAccepted === true) {
      acceptedDate = new Date();
    } else if (dto.isAccepted === false) {
      acceptedDate = null;
    }

    const record = await this.repository.update(id, {
      ...(dto.consentVersion !== undefined ? { consentVersion: dto.consentVersion } : {}),
      ...(dto.isAccepted !== undefined ? { isAccepted: dto.isAccepted } : {}),
      ...(acceptedDate !== undefined ? { acceptedDate } : {}),
      ...(dto.ipAddress !== undefined ? { ipAddress: dto.ipAddress } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserConsent',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('User consent');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserConsent',
      entityId: id,
    });

    return { message: 'User consent deleted' };
  }
}
