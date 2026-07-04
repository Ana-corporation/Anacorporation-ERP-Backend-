import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserSessionDto, UpdateUserSessionDto } from './dto/user-session.dto';
import { UserSessionsRepository } from './user-sessions.repository';

@Injectable()
export class UserSessionsService {
  constructor(
    private readonly repository: UserSessionsRepository,
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
    if (!record) throw new NotFoundException('User session');
    return serialize(record);
  }

  async create(userId: string, companyId: string, dto: CreateUserSessionDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const record = await this.repository.create({
      userId,
      companyId: dto.companyId ?? companyId,
      deviceId: dto.deviceId,
      loginTime: dto.loginTime ? new Date(dto.loginTime) : undefined,
      logoutTime: dto.logoutTime ? new Date(dto.logoutTime) : undefined,
      jwtToken: dto.jwtToken,
      refreshToken: dto.refreshToken,
      browser: dto.browser,
      browserVersion: dto.browserVersion,
      operatingSystem: dto.operatingSystem,
      deviceType: dto.deviceType,
      deviceName: dto.deviceName,
      ipAddress: dto.ipAddress,
      country: dto.country,
      city: dto.city,
      latitude: dto.latitude,
      longitude: dto.longitude,
      sessionStatus: dto.sessionStatus ?? 'active',
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserSession',
      entityId: record.sessionId.toString(),
      newValue: { sessionStatus: record.sessionStatus, deviceName: record.deviceName },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserSessionDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User session');

    const record = await this.repository.update(id, {
      ...(dto.logoutTime !== undefined
        ? { logoutTime: dto.logoutTime === null ? null : new Date(dto.logoutTime) }
        : {}),
      ...(dto.browser !== undefined ? { browser: dto.browser } : {}),
      ...(dto.browserVersion !== undefined ? { browserVersion: dto.browserVersion } : {}),
      ...(dto.operatingSystem !== undefined ? { operatingSystem: dto.operatingSystem } : {}),
      ...(dto.deviceType !== undefined ? { deviceType: dto.deviceType } : {}),
      ...(dto.deviceName !== undefined ? { deviceName: dto.deviceName } : {}),
      ...(dto.ipAddress !== undefined ? { ipAddress: dto.ipAddress } : {}),
      ...(dto.country !== undefined ? { country: dto.country } : {}),
      ...(dto.city !== undefined ? { city: dto.city } : {}),
      ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
      ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
      ...(dto.sessionStatus !== undefined ? { sessionStatus: dto.sessionStatus } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserSession',
      entityId: id,
      newValue: { sessionStatus: dto.sessionStatus },
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User session');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserSession',
      entityId: id,
    });

    return { message: 'User session deleted' };
  }
}
