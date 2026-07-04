import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';
import { ApiKeysRepository } from './api-keys.repository';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly repository: ApiKeysRepository,
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
    const apiKey = await this.repository.findById(id, userId, companyId);
    if (!apiKey) throw new NotFoundException('API key');
    return serialize(apiKey);
  }

  async create(userId: string, companyId: string, dto: CreateApiKeyDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const apiKey = `erp_${randomBytes(16).toString('hex')}`;
    const secret = randomBytes(32).toString('hex');
    const secretHash = await bcrypt.hash(secret, 12);

    const record = await this.repository.create({
      userId,
      companyId,
      name: dto.name,
      apiKey,
      secretHash,
      scope: dto.scope,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserApiKey',
      entityId: record.apiKeyId.toString(),
      newValue: { apiKey, name: record.name },
    });

    return serialize({
      ...record,
      secret,
      message: 'Store the secret securely — it will not be shown again.',
    });
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateApiKeyDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('API key');

    const record = await this.repository.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.expiryDate !== undefined
        ? { expiryDate: dto.expiryDate === null ? null : new Date(dto.expiryDate) }
        : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserApiKey',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId, companyId);
    if (!existing) throw new NotFoundException('API key');

    await this.repository.revoke(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserApiKey',
      entityId: id,
    });

    return { message: 'API key revoked' };
  }
}
