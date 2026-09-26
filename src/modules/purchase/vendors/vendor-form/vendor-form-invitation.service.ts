import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserAuditAction, VendorFormInvitationStatus } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  BusinessException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { CustomFieldsRepository } from '@/modules/shared/custom-fields/custom-fields.repository';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { getBuiltInFields } from '@/modules/shared/form-configuration/built-in-field-registry';
import { FormConfigurationService } from '@/modules/shared/form-configuration/form-configuration.service';
import { VendorsRepository } from '../vendors.repository';
import { GenerateVendorEmailDto, SubmitVendorFormDto } from './dto/vendor-form.dto';
import {
  VENDOR_FORM_ERROR_CODES,
  VENDOR_FORM_INTERNAL_ONLY_FIELD_KEYS,
  VENDOR_FORM_REMINDER_INTERVAL_HOURS,
  VENDOR_FORM_TTL_HOURS,
  VendorFormFieldSnapshotMap,
} from './vendor-form.constants';
import {
  buildFieldSnapshot,
  filterVisibleBuiltInFields,
  mergeFieldSnapshotAfterSubmit,
  splitSubmittedFields,
  toPublicFormFields,
  VendorFormFieldDefinition,
} from './vendor-form-field.util';
import {
  generateVendorFormToken,
  hashVendorFormToken,
  tokensMatch,
} from './vendor-form-token.util';
import { VendorFormInvitationRepository } from './vendor-form-invitation.repository';
import { VendorFormTokenCacheService } from './vendor-form-token-cache.service';
import { buildVendorFormInviteEmail } from './templates/vendor-form-email.template';

@Injectable()
export class VendorFormInvitationService {
  private readonly logger = new Logger(VendorFormInvitationService.name);

  constructor(
    private readonly repository: VendorFormInvitationRepository,
    private readonly vendorsRepository: VendorsRepository,
    private readonly formConfigurationService: FormConfigurationService,
    private readonly customFieldsRepository: CustomFieldsRepository,
    private readonly customFieldsValuesService: CustomFieldsValuesService,
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly tokenCache: VendorFormTokenCacheService,
  ) {}

  async generateEmail(
    vendorId: string,
    companyId: string,
    dto: GenerateVendorEmailDto,
    actorId: string,
  ) {
    const vendor = await this.vendorsRepository.findById(vendorId, companyId);
    if (!vendor) throw new NotFoundException('Vendor');

    const fieldDefs = await this.resolveFieldDefinitions(companyId);
    const customFields = await this.loadCustomFields(companyId, vendorId);
    const vendorRecord = serialize(vendor) as Record<string, unknown>;
    const fieldSnapshot = buildFieldSnapshot(vendorRecord, customFields, fieldDefs);

    const activeInvitations = await this.repository.findActiveIdsForVendor(vendorId);
    for (const row of activeInvitations) {
      await this.tokenCache.delete(row.id.toString());
    }
    await this.repository.cancelActiveForVendor(vendorId);

    const rawToken = generateVendorFormToken();
    const tokenHash = hashVendorFormToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + VENDOR_FORM_TTL_HOURS * 60 * 60 * 1000);
    const nextReminderAt = new Date(
      now.getTime() + VENDOR_FORM_REMINDER_INTERVAL_HOURS * 60 * 60 * 1000,
    );

    const invitation = await this.repository.create({
      vendorId,
      companyId,
      tokenHash,
      recipientEmail: dto.toEmail,
      generatedBy: actorId,
      generatedAt: now,
      expiresAt,
      nextReminderAt,
      maxSendCount: dto.maxSendCount,
      fieldSnapshot,
    });

    const formUrl = this.buildFormUrl(rawToken);
    const emailContent = buildVendorFormInviteEmail({
      vendorName: vendor.name,
      formUrl,
    });

    let emailResult: { sent: boolean; stub?: boolean };
    try {
      emailResult = await this.mailService.sendMail({
        to: dto.toEmail,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email send failed';
      await this.repository.markSendFailed(invitation.id.toString(), message);
      throw new BusinessException(
        'Failed to send vendor form email',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    await this.tokenCache.store(invitation.id.toString(), rawToken, expiresAt);

    await this.repository.markSent(
      invitation.id.toString(),
      1,
      now,
      nextReminderAt,
    );

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'VendorFormInvitation',
      entityId: invitation.id.toString(),
      newValue: {
        vendorId,
        recipientEmail: dto.toEmail,
        maxSendCount: dto.maxSendCount,
        emailSent: emailResult.sent,
        emailStub: emailResult.stub ?? false,
      },
    });

    return serialize({
      invitationId: invitation.id,
      vendorId,
      status: VendorFormInvitationStatus.SENT,
      recipientEmail: dto.toEmail,
      sendCount: 1,
      maxSendCount: dto.maxSendCount,
      generatedAt: now,
      expiresAt,
      lastSentAt: now,
      nextReminderAt,
      emailSent: emailResult.sent,
      emailStub: emailResult.stub ?? false,
      ...(emailResult.stub ? { formUrl } : {}),
    });
  }

  async getEmailStatus(vendorId: string, companyId: string) {
    const vendor = await this.vendorsRepository.findById(vendorId, companyId);
    if (!vendor) throw new NotFoundException('Vendor');

    const invitation = await this.repository.findLatestForVendor(vendorId, companyId);
    if (!invitation) {
      return { vendorId, hasInvitation: false };
    }

    return serialize({
      vendorId,
      hasInvitation: true,
      invitationId: invitation.id,
      status: invitation.status,
      recipientEmail: invitation.recipientEmail,
      sendCount: invitation.sendCount,
      maxSendCount: invitation.maxSendCount,
      generatedAt: invitation.generatedAt,
      expiresAt: invitation.expiresAt,
      submittedAt: invitation.submittedAt,
      lastSentAt: invitation.lastSentAt,
      nextReminderAt: invitation.nextReminderAt,
      lastError: invitation.lastError,
    });
  }

  async getFormByToken(rawToken: string) {
    const invitation = await this.findValidInvitation(rawToken);

    const fieldDefs = await this.resolveFieldDefinitions(invitation.companyId.toString());
    const snapshot = this.parseFieldSnapshot(invitation.fieldSnapshot);

    return serialize({
      valid: true,
      vendor: {
        vendorId: invitation.vendorId.toString(),
        vendorName: invitation.vendor.name,
        contactEmail: invitation.recipientEmail,
      },
      form: {
        fields: toPublicFormFields(fieldDefs, snapshot),
      },
      expiresAt: invitation.expiresAt,
    });
  }

  async submitForm(rawToken: string, dto: SubmitVendorFormDto) {
    const invitation = await this.findValidInvitation(rawToken);
    const companyId = invitation.companyId.toString();
    const vendorId = invitation.vendorId.toString();
    const fieldDefs = await this.resolveFieldDefinitions(companyId);
    const allowedKeys = new Set(fieldDefs.map((f) => f.key));
    const editableKeys = new Set(fieldDefs.filter((f) => f.editable).map((f) => f.key));
    const snapshot = this.parseFieldSnapshot(invitation.fieldSnapshot);

    for (const key of Object.keys(dto.fields)) {
      if (!allowedKeys.has(key)) {
        throw new BusinessException(
          `Field "${key}" is not allowed`,
          HttpStatus.BAD_REQUEST,
          undefined,
          VENDOR_FORM_ERROR_CODES.FIELD_NOT_ALLOWED,
        );
      }
      if (VENDOR_FORM_INTERNAL_ONLY_FIELD_KEYS.has(key)) {
        throw new BusinessException(
          `Field "${key}" cannot be modified via vendor form`,
          HttpStatus.BAD_REQUEST,
          undefined,
          VENDOR_FORM_ERROR_CODES.INTERNAL_FIELD,
        );
      }
      if (!editableKeys.has(key)) {
        throw new BusinessException(
          `Field "${key}" is read-only`,
          HttpStatus.BAD_REQUEST,
          undefined,
          VENDOR_FORM_ERROR_CODES.FIELD_NOT_ALLOWED,
        );
      }
    }

    const submittedEditable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto.fields)) {
      if (editableKeys.has(key)) {
        submittedEditable[key] = value;
      }
    }

    const { core, metadata, customFields } = splitSubmittedFields(
      submittedEditable,
      fieldDefs,
    );

    const existing = invitation.vendor;
    const mergedMetadata =
      Object.keys(metadata).length > 0
        ? {
            ...(existing.metadata &&
            typeof existing.metadata === 'object' &&
            !Array.isArray(existing.metadata)
              ? (existing.metadata as Record<string, unknown>)
              : {}),
            ...metadata,
          }
        : undefined;

    await this.prisma.$transaction(async (tx) => {
      const client = tx as unknown as Prisma.TransactionClient;
      const updateData: Prisma.VendorUpdateInput = {
        updatedAt: new Date(),
      };

      if (core.name !== undefined) updateData.name = String(core.name);
      if (core.email !== undefined) updateData.email = core.email ? String(core.email) : null;
      if (core.phone !== undefined) updateData.phone = core.phone ? String(core.phone) : null;
      if (core.address !== undefined) updateData.address = core.address ? String(core.address) : null;
      if (core.city !== undefined) updateData.city = core.city ? String(core.city) : null;
      if (core.country !== undefined) updateData.country = core.country ? String(core.country) : null;
      if (core.taxId !== undefined) updateData.taxId = core.taxId ? String(core.taxId) : null;
      if (mergedMetadata !== undefined) updateData.metadata = mergedMetadata as Prisma.InputJsonValue;

      const hasCoreUpdate = Object.keys(updateData).length > 1;
      if (hasCoreUpdate) {
        await client.vendor.update({
          where: { vendorId: invitation.vendorId },
          data: updateData,
        });
      }

      if (Object.keys(customFields).length > 0) {
        await this.customFieldsValuesService.persistCustomFields(
          companyId,
          'vendor',
          vendorId,
          customFields,
          'update',
          client,
        );
      }
    });

    const updatedSnapshot = mergeFieldSnapshotAfterSubmit(snapshot, submittedEditable);
    const submittedAt = new Date();
    await this.repository.markSubmitted(
      invitation.id.toString(),
      submittedAt,
      updatedSnapshot,
    );
    await this.tokenCache.delete(invitation.id.toString());

    await this.auditService.log({
      companyId,
      action: UserAuditAction.update,
      entityName: 'VendorFormSubmission',
      entityId: vendorId,
      newValue: {
        invitationId: invitation.id.toString(),
        submittedFieldKeys: Object.keys(submittedEditable),
      },
    });

    return serialize({
      success: true,
      submittedAt,
      message: 'Vendor form submitted successfully',
    });
  }

  async processReminders() {
    const now = new Date();
    const candidates = await this.repository.findDueReminders(now);
    const due = candidates.filter((inv) => inv.sendCount < inv.maxSendCount);

    const results: Array<{
      invitationId: string;
      vendorId: string;
      sent: boolean;
      error?: string;
    }> = [];

    for (const invitation of due) {
      const invitationId = invitation.id.toString();
      try {
        if (invitation.expiresAt && invitation.expiresAt.getTime() <= now.getTime()) {
          await this.repository.markExpired(invitationId);
          results.push({
            invitationId,
            vendorId: invitation.vendorId.toString(),
            sent: false,
            error: 'expired',
          });
          continue;
        }

        const rawToken = await this.tokenCache.get(invitationId);
        if (!rawToken) {
          results.push({
            invitationId,
            vendorId: invitation.vendorId.toString(),
            sent: false,
            error: 'token_unavailable_for_reminder',
          });
          continue;
        }

        const formUrl = this.buildFormUrl(rawToken);
        const emailContent = buildVendorFormInviteEmail({
          vendorName: invitation.vendor.name,
          formUrl,
          isReminder: true,
        });

        await this.mailService.sendMail({
          to: invitation.recipientEmail,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });

        const nextReminderAt = new Date(
          now.getTime() + VENDOR_FORM_REMINDER_INTERVAL_HOURS * 60 * 60 * 1000,
        );
        await this.repository.markSent(
          invitationId,
          invitation.sendCount + 1,
          now,
          nextReminderAt,
        );

        results.push({
          invitationId,
          vendorId: invitation.vendorId.toString(),
          sent: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reminder failed';
        await this.repository.markSendFailed(invitationId, message);
        this.logger.warn(`Reminder failed for invitation ${invitationId}: ${message}`);
        results.push({
          invitationId,
          vendorId: invitation.vendorId.toString(),
          sent: false,
          error: message,
        });
      }
    }

    return {
      processed: results.length,
      sent: results.filter((r) => r.sent).length,
      results,
    };
  }

  private async findValidInvitation(rawToken: string) {
    if (!rawToken || rawToken.length < 32) {
      throw new BusinessException(
        'Invalid vendor form link',
        HttpStatus.NOT_FOUND,
        undefined,
        VENDOR_FORM_ERROR_CODES.INVALID,
      );
    }

    const tokenHash = hashVendorFormToken(rawToken);
    const invitation = await this.repository.findByTokenHash(tokenHash);

    if (!invitation || !tokensMatch(rawToken, invitation.tokenHash)) {
      throw new BusinessException(
        'Invalid vendor form link',
        HttpStatus.NOT_FOUND,
        undefined,
        VENDOR_FORM_ERROR_CODES.INVALID,
      );
    }

    if (invitation.vendor.deletedAt) {
      throw new BusinessException(
        'Invalid vendor form link',
        HttpStatus.NOT_FOUND,
        undefined,
        VENDOR_FORM_ERROR_CODES.INVALID,
      );
    }

    if (invitation.status === VendorFormInvitationStatus.SUBMITTED) {
      throw new BusinessException(
        'This vendor form has already been submitted',
        HttpStatus.GONE,
        undefined,
        VENDOR_FORM_ERROR_CODES.SUBMITTED,
      );
    }

    if (invitation.status === VendorFormInvitationStatus.CANCELLED) {
      throw new BusinessException(
        'This vendor form link is no longer valid',
        HttpStatus.GONE,
        undefined,
        VENDOR_FORM_ERROR_CODES.CANCELLED,
      );
    }

    const now = Date.now();
    if (!invitation.expiresAt || invitation.expiresAt.getTime() <= now) {
      if (invitation.status !== VendorFormInvitationStatus.EXPIRED) {
        await this.repository.markExpired(invitation.id.toString());
      }
      throw new BusinessException(
        'This vendor form link has expired.',
        HttpStatus.GONE,
        undefined,
        VENDOR_FORM_ERROR_CODES.EXPIRED,
      );
    }

    return invitation;
  }

  private async resolveFieldDefinitions(companyId: string): Promise<VendorFormFieldDefinition[]> {
    const overrides = await this.formConfigurationService.loadOverrideMap(companyId, 'vendor');
    const builtIn = filterVisibleBuiltInFields(getBuiltInFields('vendor'), overrides);

    const definitions = await this.customFieldsRepository.findDefinitionsByCompany(
      companyId,
      'vendor',
      false,
    );

    const custom: VendorFormFieldDefinition[] = definitions
      .filter((d) => !d.isHidden)
      .map((d) => ({
        key: d.fieldName,
        label: d.displayName,
        fieldType: d.fieldType,
        sectionKey: d.sectionKey ?? 'custom',
        required: d.isRequired,
        editable: !d.isReadOnly,
        source: 'CUSTOM' as const,
      }));

    return [...builtIn, ...custom];
  }

  private async loadCustomFields(companyId: string, vendorId: string) {
    const maps = await this.customFieldsValuesService.loadCustomFieldsMapsForRecords(
      companyId,
      'vendor',
      [BigInt(vendorId)],
    );
    return maps.get(vendorId) ?? {};
  }

  private parseFieldSnapshot(raw: unknown): VendorFormFieldSnapshotMap {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as VendorFormFieldSnapshotMap;
  }

  private buildFormUrl(rawToken: string): string {
    const origin =
      this.configService.get<string>('app.frontendOrigin') ??
      process.env.FRONTEND_ORIGIN ??
      'http://localhost:3001';
    return `${origin.replace(/\/$/, '')}/vendor-form/${rawToken}`;
  }
}
