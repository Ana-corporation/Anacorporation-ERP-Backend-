import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CreateUserDeviceDto, UpdateUserDeviceDto } from './dto/user-device.dto';
import { UserDevicesRepository } from './user-devices.repository';

@Injectable()
export class UserDevicesService {
  constructor(
    private readonly repository: UserDevicesRepository,
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
    const device = await this.repository.findById(id, userId);
    if (!device) throw new NotFoundException('User device');
    return serialize(device);
  }

  async create(userId: string, companyId: string, dto: CreateUserDeviceDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const existing = await this.repository.findByDeviceUuid(userId, dto.deviceUuid);
    if (existing) throw new ConflictException('Device UUID already registered for this user');

    const record = await this.repository.create({
      userId,
      deviceUuid: dto.deviceUuid,
      deviceName: dto.deviceName,
      manufacturer: dto.manufacturer,
      model: dto.model,
      os: dto.os,
      browser: dto.browser,
      lastSeen: dto.lastSeen ? new Date(dto.lastSeen) : new Date(),
      isTrusted: dto.isTrusted ?? false,
      isBlocked: dto.isBlocked ?? false,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserDevice',
      entityId: record.deviceId.toString(),
      newValue: { deviceUuid: record.deviceUuid, deviceName: record.deviceName },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, id: string, dto: UpdateUserDeviceDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User device');

    const record = await this.repository.update(id, {
      ...(dto.deviceName !== undefined ? { deviceName: dto.deviceName } : {}),
      ...(dto.manufacturer !== undefined ? { manufacturer: dto.manufacturer } : {}),
      ...(dto.model !== undefined ? { model: dto.model } : {}),
      ...(dto.os !== undefined ? { os: dto.os } : {}),
      ...(dto.browser !== undefined ? { browser: dto.browser } : {}),
      ...(dto.lastSeen !== undefined
        ? { lastSeen: dto.lastSeen === null ? null : new Date(dto.lastSeen) }
        : {}),
      ...(dto.isTrusted !== undefined ? { isTrusted: dto.isTrusted } : {}),
      ...(dto.isBlocked !== undefined ? { isBlocked: dto.isBlocked } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserDevice',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, id: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findById(id, userId);
    if (!existing) throw new NotFoundException('User device');

    await this.repository.delete(id);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserDevice',
      entityId: id,
    });

    return { message: 'User device deleted' };
  }
}
