import { Injectable } from '@nestjs/common';
import { Prisma, VendorFormInvitationStatus } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { VendorFormFieldSnapshotMap } from './vendor-form.constants';

export type VendorFormInvitationSummary = {
  status: VendorFormInvitationStatus;
  sendCount: number;
  maxSendCount: number;
  submittedAt: Date | null;
};

export const INVITATION_COMPANY_SELECT = {
  companyId: true,
  name: true,
  legalName: true,
  email: true,
  phone: true,
  logoUrl: true,
} satisfies Prisma.CompanySelect;

export type InvitationCompany = Prisma.CompanyGetPayload<{
  select: typeof INVITATION_COMPANY_SELECT;
}>;

type CreateInvitationParams = {
  vendorId: string;
  companyId: string;
  tokenHash: string;
  recipientEmail: string;
  generatedBy: string;
  generatedAt: Date;
  expiresAt: Date;
  nextReminderAt: Date;
  maxSendCount: number;
  fieldSnapshot: VendorFormFieldSnapshotMap;
};

@Injectable()
export class VendorFormInvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveIdsForVendor(vendorId: string) {
    return this.prisma.vendorFormInvitation.findMany({
      where: {
        vendorId: parseBigIntId(vendorId),
        status: { in: [VendorFormInvitationStatus.PENDING, VendorFormInvitationStatus.SENT] },
      },
      select: { id: true },
    });
  }

  cancelActiveForVendor(vendorId: string, excludeId?: string) {
    return this.prisma.vendorFormInvitation.updateMany({
      where: {
        vendorId: parseBigIntId(vendorId),
        status: { in: [VendorFormInvitationStatus.PENDING, VendorFormInvitationStatus.SENT] },
        ...(excludeId ? { id: { not: parseBigIntId(excludeId) } } : {}),
      },
      data: {
        status: VendorFormInvitationStatus.CANCELLED,
        updatedAt: new Date(),
      },
    });
  }

  create(params: CreateInvitationParams) {
    return this.prisma.vendorFormInvitation.create({
      data: {
        vendorId: parseBigIntId(params.vendorId),
        companyId: parseBigIntId(params.companyId),
        tokenHash: params.tokenHash,
        recipientEmail: params.recipientEmail,
        generatedBy: parseBigIntId(params.generatedBy),
        generatedAt: params.generatedAt,
        expiresAt: params.expiresAt,
        nextReminderAt: params.nextReminderAt,
        maxSendCount: params.maxSendCount,
        sendCount: 0,
        status: VendorFormInvitationStatus.PENDING,
        fieldSnapshot: params.fieldSnapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  findByTokenHash(tokenHash: string) {
    return this.prisma.vendorFormInvitation.findFirst({
      where: { tokenHash },
      include: {
        vendor: true,
        company: { select: INVITATION_COMPANY_SELECT },
      },
    });
  }

  /** Unexpired PENDING/SENT invitation to this email for a live vendor in the company. */
  findOpenByRecipientEmail(companyId: string, recipientEmail: string, now: Date) {
    return this.prisma.vendorFormInvitation.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        recipientEmail: { equals: recipientEmail, mode: 'insensitive' },
        status: { in: [VendorFormInvitationStatus.PENDING, VendorFormInvitationStatus.SENT] },
        expiresAt: { gt: now },
        vendor: { deletedAt: null },
      },
      select: { id: true, vendorId: true },
    });
  }

  /** Latest invitation per vendor, ignoring cancelled ones. */
  async findLatestNonCancelledByVendorIds(companyId: string, vendorIds: bigint[]) {
    if (!vendorIds.length) return new Map<string, VendorFormInvitationSummary>();

    const rows = await this.prisma.vendorFormInvitation.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        vendorId: { in: vendorIds },
        status: { not: VendorFormInvitationStatus.CANCELLED },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        vendorId: true,
        status: true,
        sendCount: true,
        maxSendCount: true,
        submittedAt: true,
      },
    });

    const latest = new Map<string, VendorFormInvitationSummary>();
    for (const row of rows) {
      const key = row.vendorId.toString();
      if (latest.has(key)) continue;
      latest.set(key, {
        status: row.status,
        sendCount: row.sendCount,
        maxSendCount: row.maxSendCount,
        submittedAt: row.submittedAt,
      });
    }
    return latest;
  }

  findLatestForVendor(vendorId: string, companyId: string) {
    return this.prisma.vendorFormInvitation.findFirst({
      where: {
        vendorId: parseBigIntId(vendorId),
        companyId: parseBigIntId(companyId),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  markSent(id: string, sendCount: number, lastSentAt: Date, nextReminderAt: Date) {
    return this.prisma.vendorFormInvitation.update({
      where: { id: parseBigIntId(id) },
      data: {
        status: VendorFormInvitationStatus.SENT,
        sendCount,
        lastSentAt,
        nextReminderAt,
        lastError: null,
        updatedAt: new Date(),
      },
    });
  }

  markSendFailed(id: string, error: string) {
    return this.prisma.vendorFormInvitation.update({
      where: { id: parseBigIntId(id) },
      data: {
        lastError: error.slice(0, 2000),
        updatedAt: new Date(),
      },
    });
  }

  markSubmitted(
    id: string,
    submittedAt: Date,
    fieldSnapshot: VendorFormFieldSnapshotMap,
  ) {
    return this.prisma.vendorFormInvitation.update({
      where: { id: parseBigIntId(id) },
      data: {
        status: VendorFormInvitationStatus.SUBMITTED,
        submittedAt,
        fieldSnapshot: fieldSnapshot as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  }

  markExpired(id: string) {
    return this.prisma.vendorFormInvitation.update({
      where: { id: parseBigIntId(id) },
      data: {
        status: VendorFormInvitationStatus.EXPIRED,
        updatedAt: new Date(),
      },
    });
  }

  findDueReminders(now: Date) {
    return this.prisma.vendorFormInvitation.findMany({
      where: {
        status: VendorFormInvitationStatus.SENT,
        expiresAt: { gt: now },
        nextReminderAt: { lte: now },
      },
      include: { vendor: true, company: { select: INVITATION_COMPANY_SELECT } },
    });
  }
}
