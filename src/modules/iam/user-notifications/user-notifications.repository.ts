import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';

@Injectable()
export class UserNotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  assertUserInCompany(userId: string, companyId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'active',
      },
    });
  }

  findByUserId(userId: string) {
    return this.prisma.userNotification.findUnique({
      where: { userId: parseBigIntId(userId) },
      select: this.publicSelect(),
    });
  }

  create(data: {
    userId: string;
    emailEnabled: boolean;
    smsEnabled: boolean;
    whatsappEnabled: boolean;
    pushEnabled: boolean;
    teamsEnabled: boolean;
    slackEnabled: boolean;
  }) {
    return this.prisma.userNotification.create({
      data: {
        userId: parseBigIntId(data.userId),
        emailEnabled: data.emailEnabled,
        smsEnabled: data.smsEnabled,
        whatsappEnabled: data.whatsappEnabled,
        pushEnabled: data.pushEnabled,
        teamsEnabled: data.teamsEnabled,
        slackEnabled: data.slackEnabled,
      },
      select: this.publicSelect(),
    });
  }

  update(
    userId: string,
    data: Partial<{
      emailEnabled: boolean;
      smsEnabled: boolean;
      whatsappEnabled: boolean;
      pushEnabled: boolean;
      teamsEnabled: boolean;
      slackEnabled: boolean;
    }>,
  ) {
    return this.prisma.userNotification.update({
      where: { userId: parseBigIntId(userId) },
      data: {
        ...(data.emailEnabled !== undefined ? { emailEnabled: data.emailEnabled } : {}),
        ...(data.smsEnabled !== undefined ? { smsEnabled: data.smsEnabled } : {}),
        ...(data.whatsappEnabled !== undefined ? { whatsappEnabled: data.whatsappEnabled } : {}),
        ...(data.pushEnabled !== undefined ? { pushEnabled: data.pushEnabled } : {}),
        ...(data.teamsEnabled !== undefined ? { teamsEnabled: data.teamsEnabled } : {}),
        ...(data.slackEnabled !== undefined ? { slackEnabled: data.slackEnabled } : {}),
        updatedAt: new Date(),
      },
      select: this.publicSelect(),
    });
  }

  delete(userId: string) {
    return this.prisma.userNotification.delete({
      where: { userId: parseBigIntId(userId) },
      select: this.publicSelect(),
    });
  }

  private publicSelect() {
    return {
      notificationId: true,
      userId: true,
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: true,
      pushEnabled: true,
      teamsEnabled: true,
      slackEnabled: true,
      updatedAt: true,
    } satisfies Prisma.UserNotificationSelect;
  }
}
