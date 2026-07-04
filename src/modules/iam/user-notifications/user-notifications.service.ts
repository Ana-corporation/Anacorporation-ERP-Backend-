import { Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { ConflictException, NotFoundException } from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { CreateUserNotificationDto, UpdateUserNotificationDto } from './dto/user-notification.dto';
import { UserNotificationsRepository } from './user-notifications.repository';

@Injectable()
export class UserNotificationsService {
  constructor(
    private readonly repository: UserNotificationsRepository,
    private readonly auditService: AuditService,
  ) {}

  private async ensureUserInCompany(userId: string, companyId: string) {
    const membership = await this.repository.assertUserInCompany(userId, companyId);
    if (!membership) throw new NotFoundException('User');
  }

  async findSettings(userId: string, companyId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const record = await this.repository.findByUserId(userId);
    if (!record) throw new NotFoundException('User notification settings');
    return serialize(record);
  }

  async create(userId: string, companyId: string, dto: CreateUserNotificationDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);

    const existing = await this.repository.findByUserId(userId);
    if (existing) throw new ConflictException('User notification settings already exist');

    const record = await this.repository.create({
      userId,
      emailEnabled: dto.emailEnabled ?? true,
      smsEnabled: dto.smsEnabled ?? false,
      whatsappEnabled: dto.whatsappEnabled ?? false,
      pushEnabled: dto.pushEnabled ?? true,
      teamsEnabled: dto.teamsEnabled ?? false,
      slackEnabled: dto.slackEnabled ?? false,
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserNotification',
      entityId: record.notificationId.toString(),
      newValue: { emailEnabled: record.emailEnabled, pushEnabled: record.pushEnabled },
    });

    return serialize(record);
  }

  async update(userId: string, companyId: string, dto: UpdateUserNotificationDto, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findByUserId(userId);
    if (!existing) throw new NotFoundException('User notification settings');

    const record = await this.repository.update(userId, {
      ...(dto.emailEnabled !== undefined ? { emailEnabled: dto.emailEnabled } : {}),
      ...(dto.smsEnabled !== undefined ? { smsEnabled: dto.smsEnabled } : {}),
      ...(dto.whatsappEnabled !== undefined ? { whatsappEnabled: dto.whatsappEnabled } : {}),
      ...(dto.pushEnabled !== undefined ? { pushEnabled: dto.pushEnabled } : {}),
      ...(dto.teamsEnabled !== undefined ? { teamsEnabled: dto.teamsEnabled } : {}),
      ...(dto.slackEnabled !== undefined ? { slackEnabled: dto.slackEnabled } : {}),
    });

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserNotification',
      entityId: existing.notificationId.toString(),
      newValue: dto as Record<string, unknown>,
    });

    return serialize(record);
  }

  async remove(userId: string, companyId: string, actorId: string) {
    await this.ensureUserInCompany(userId, companyId);
    const existing = await this.repository.findByUserId(userId);
    if (!existing) throw new NotFoundException('User notification settings');

    await this.repository.delete(userId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserNotification',
      entityId: existing.notificationId.toString(),
    });

    return { message: 'User notification settings deleted' };
  }
}
