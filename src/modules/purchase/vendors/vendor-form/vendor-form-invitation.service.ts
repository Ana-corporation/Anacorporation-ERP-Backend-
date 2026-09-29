import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserAuditAction, Vendor, VendorFormInvitationStatus } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { normalizePhoneNumber } from '@/common/utils/phone.util';
import { CustomFieldsRepository } from '@/modules/shared/custom-fields/custom-fields.repository';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import {
  getBuiltInFields,
  resolveCustomRegistrationVisibility,
} from '@/modules/shared/form-configuration/built-in-field-registry';
import { FormConfigurationService } from '@/modules/shared/form-configuration/form-configuration.service';
import {
  DRAFT_VENDOR_CODE_PREFIX,
  isDraftVendorCode,
  isSupplierType,
  SUPPLIER_TYPE_PREFIX,
} from '../vendor-code.util';
import { vendorAttachmentsFromRecord } from '../vendor-attachments.constants';
import { VendorsRepository } from '../vendors.repository';
import { GstinService } from '@/modules/shared/gstin/gstin.service';
import { TabAccessService } from '@/modules/shared/tab-access/tab-access.service';
import {
  GenerateVendorEmailDto,
  SubmitVendorFormDto,
  VerifyVendorFormGstinDto,
} from './dto/vendor-form.dto';
import {
  VENDOR_FORM_ERROR_CODES,
  VENDOR_FORM_REMINDER_INTERVAL_HOURS,
  VENDOR_FORM_TTL_HOURS,
  VendorFormFieldSnapshotMap,
} from './vendor-form.constants';
import {
  applyDraftVendorFieldRules,
  blankDraftVendorSnapshot,
  BUILT_IN_PHONE_FIELD_KEYS,
  buildFieldSnapshot,
  filterRegistrationBuiltInFields,
  isFieldEmpty,
  mapCustomToFormField,
  mergeFieldSnapshotAfterSubmit,
  sortVendorFormFields,
  splitSubmittedFields,
  SUPPLIER_TYPE_FIELD_KEY,
  toPublicFormFields,
  VENDOR_NAME_FIELD_KEY,
  VendorFormFieldDefinition,
} from './vendor-form-field.util';
import {
  generateVendorFormToken,
  hashVendorFormToken,
  tokensMatch,
} from './vendor-form-token.util';
import {
  INVITATION_COMPANY_SELECT,
  InvitationCompany,
  VendorFormInvitationRepository,
} from './vendor-form-invitation.repository';
import { VendorFormTokenCacheService } from './vendor-form-token-cache.service';
import {
  buildAttachmentsBlock,
  detectVendorFormAttachmentMime,
  invitationAttachments,
  isVendorLinkAttachment,
  metadataObject,
  toPublicAttachment,
  VENDOR_FORM_ATTACHMENT_MAX_BYTES,
  VENDOR_FORM_ATTACHMENT_MAX_FILES,
  VENDOR_LINK_ATTACHMENT_SOURCE,
  VendorLinkAttachment,
} from './vendor-form-attachments.util';

export type UploadedVendorFormFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};
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
    private readonly gstinService: GstinService,
    private readonly tabAccessService: TabAccessService,
    private readonly storageService: StorageService,
  ) {}

  async generateEmail(
    vendorId: string,
    companyId: string,
    dto: GenerateVendorEmailDto,
    actorId: string,
  ) {
    const vendor = await this.vendorsRepository.findById(vendorId, companyId);
    if (!vendor) throw new NotFoundException('Vendor');

    return this.issueInvitation(vendor, await this.loadCompany(companyId), dto, actorId);
  }

  /** "Send Vendor Registration": creates a draft vendor, then invites the recipient to complete it. */
  async createRegistrationInvitation(
    companyId: string,
    dto: GenerateVendorEmailDto,
    actorId: string,
  ) {
    const toEmail = dto.toEmail.trim().toLowerCase();
    const pending = await this.repository.findOpenByRecipientEmail(companyId, toEmail, new Date());
    if (pending) {
      throw new ConflictException(
        'A vendor registration is already pending for this email.',
        VENDOR_FORM_ERROR_CODES.REGISTRATION_PENDING,
      );
    }

    const company = await this.loadCompany(companyId);

    let draft: Vendor;
    try {
      draft = await this.prisma.$transaction(async (tx) => {
        const client = tx as unknown as Prisma.TransactionClient;
        const vendorCode = await this.vendorsRepository.nextVendorCode(
          companyId,
          DRAFT_VENDOR_CODE_PREFIX,
          client,
        );
        return this.vendorsRepository.createDraft(companyId, toEmail, vendorCode, actorId, client);
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Vendor code already exists. Please try again.');
      }
      throw error;
    }

    try {
      return await this.issueInvitation(draft, company, { ...dto, toEmail }, actorId);
    } catch (error) {
      // No email went out, so the draft (and its invitation, via cascade) must not linger in the list.
      await this.vendorsRepository.hardDelete(draft.vendorId.toString()).catch((cleanupError) => {
        this.logger.error(
          `Could not remove draft vendor ${draft.vendorId} after failed registration send: ${
            cleanupError instanceof Error ? cleanupError.message : cleanupError
          }`,
        );
      });
      throw error;
    }
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
    const isDraft = isDraftVendorCode(invitation.vendor.vendorCode);

    const { fieldDefs, attachmentsEnabled } = await this.loadRegistrationForm(
      invitation.companyId.toString(),
      isDraft,
    );
    const snapshot = await this.currentFieldSnapshot(invitation.vendor, fieldDefs, isDraft);
    const files = invitationAttachments(invitation.vendor.metadata, invitation.id.toString());

    return serialize({
      valid: true,
      company: await this.publicCompany(invitation.company),
      vendor: {
        vendorId: invitation.vendorId.toString(),
        vendorName: isDraft ? '' : invitation.vendor.name,
        contactEmail: invitation.recipientEmail,
        isDraft,
      },
      form: {
        fields: toPublicFormFields(fieldDefs, snapshot),
      },
      attachments: buildAttachmentsBlock(attachmentsEnabled, files),
      expiresAt: invitation.expiresAt,
    });
  }

  /** Same fields, order and shape as GET /vendor-form/:token for a new vendor, with empty values. */
  async getRegistrationPreview(companyId: string) {
    const company = await this.loadCompany(companyId);
    const { fieldDefs, attachmentsEnabled } = await this.loadRegistrationForm(companyId);

    return serialize({
      company: await this.publicCompany(company),
      form: { fields: toPublicFormFields(fieldDefs, {}) },
      attachments: buildAttachmentsBlock(attachmentsEnabled, []),
    });
  }

  /** Same checks and error codes as GET /vendor-form/:token. */
  async assertOpenInvitation(rawToken: string): Promise<void> {
    await this.findValidInvitation(rawToken);
  }

  async uploadAttachmentsByToken(rawToken: string, files: UploadedVendorFormFile[]) {
    const invitation = await this.findValidInvitation(rawToken);
    const companyId = invitation.companyId.toString();
    const vendorId = invitation.vendorId.toString();
    const invitationId = invitation.id.toString();

    const { attachmentsEnabled } = await this.loadRegistrationForm(companyId);
    if (!attachmentsEnabled) {
      throw new BusinessException(
        'Attachments are not enabled for this form',
        HttpStatus.FORBIDDEN,
        undefined,
        VENDOR_FORM_ERROR_CODES.ATTACHMENTS_DISABLED,
      );
    }

    const validated = this.validateAttachmentFiles(files);
    const existing = invitationAttachments(invitation.vendor.metadata, invitationId);
    this.assertAttachmentCount(existing.length + validated.length);

    const uploaded: VendorLinkAttachment[] = [];
    try {
      for (const { file, mimeType } of validated) {
        const asset = await this.storageService.uploadFile({
          organizationId: companyId,
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType,
          entityType: 'vendor',
          entityId: vendorId,
        });
        const uploadedAt = asset.createdAt.toISOString();
        uploaded.push({
          fileAssetId: asset.id,
          fileName: asset.originalName,
          mimeType: asset.mimeType,
          fileSize: asset.sizeBytes,
          storageKey: asset.storageKey,
          attachmentDate: uploadedAt.slice(0, 10),
          uploadedAt,
          status: 'uploaded',
          source: VENDOR_LINK_ATTACHMENT_SOURCE,
          uploadedBy: 'Vendor',
          invitationId,
        });
      }
    } catch (error) {
      await this.discardUploadedFiles(companyId, vendorId, uploaded);
      this.logger.error(
        `Vendor link upload failed for invitation ${invitationId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      throw new BusinessException('File upload failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    let remaining: VendorLinkAttachment[];
    try {
      remaining = await this.updateVendorAttachments(invitation.vendorId, invitationId, (attachments) => {
        const current = attachments.filter((row) => isVendorLinkAttachment(row, invitationId));
        this.assertAttachmentCount(current.length + uploaded.length);
        return [...attachments, ...uploaded];
      });
    } catch (error) {
      await this.discardUploadedFiles(companyId, vendorId, uploaded);
      throw error;
    }

    await this.auditService.log({
      companyId,
      action: UserAuditAction.update,
      entityName: 'VendorAttachment',
      entityId: vendorId,
      newValue: {
        source: VENDOR_LINK_ATTACHMENT_SOURCE,
        invitationId,
        uploaded: uploaded.map((a) => a.fileAssetId),
      },
    });

    return { files: remaining.map(toPublicAttachment) };
  }

  /** Vendors can remove only what they uploaded through this link, and only before submitting. */
  async deleteAttachmentByToken(rawToken: string, fileAssetId: string) {
    const invitation = await this.findValidInvitation(rawToken);
    const companyId = invitation.companyId.toString();
    const vendorId = invitation.vendorId.toString();
    const invitationId = invitation.id.toString();

    const owned = invitationAttachments(invitation.vendor.metadata, invitationId).some(
      (a) => a.fileAssetId === fileAssetId,
    );
    if (!owned) {
      throw new BusinessException(
        'Attachment not found',
        HttpStatus.NOT_FOUND,
        undefined,
        VENDOR_FORM_ERROR_CODES.ATTACHMENT_NOT_FOUND,
      );
    }

    const remaining = await this.updateVendorAttachments(
      invitation.vendorId,
      invitationId,
      (attachments) =>
        attachments.filter(
          (row) => !(isVendorLinkAttachment(row, invitationId) && row.fileAssetId === fileAssetId),
        ),
    );
    await this.storageService.deleteFile(companyId, fileAssetId, {
      entityType: 'vendor',
      entityId: vendorId,
    });

    await this.auditService.log({
      companyId,
      action: UserAuditAction.delete,
      entityName: 'VendorAttachment',
      entityId: vendorId,
      newValue: { source: VENDOR_LINK_ATTACHMENT_SOURCE, invitationId, fileAssetId },
    });

    return { files: remaining.map(toPublicAttachment) };
  }

  /** Public route: the invitation token authorises the lookup; provider payload and credits stay internal. */
  async verifyGstinByToken(rawToken: string, dto: VerifyVendorFormGstinDto) {
    const invitation = await this.findValidInvitation(rawToken);
    const result = await this.gstinService.verifyForCompany(invitation.companyId.toString(), {
      gstin: dto.gstin,
      includeProfile: true,
    });

    return {
      gstin: result.gstin,
      verified: result.verified,
      suggestedFields: result.suggestedFields,
    };
  }

  async submitForm(rawToken: string, dto: SubmitVendorFormDto) {
    const invitation = await this.findValidInvitation(rawToken);
    const companyId = invitation.companyId.toString();
    const vendorId = invitation.vendorId.toString();
    const isDraft = isDraftVendorCode(invitation.vendor.vendorCode);
    const { fieldDefs, attachmentsEnabled } = await this.loadRegistrationForm(companyId, isDraft);
    const editableDefs = new Map(fieldDefs.filter((f) => f.editable).map((f) => [f.key, f]));
    const current = await this.currentFieldSnapshot(invitation.vendor, fieldDefs, isDraft);

    // Keys the vendor cannot see or edit are dropped, so staff data is never overwritten.
    const submittedEditable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto.fields)) {
      if (editableDefs.has(key)) {
        submittedEditable[key] = typeof value === 'string' ? value.trim() : value;
      }
    }

    this.normalizeBuiltInPhones(submittedEditable, editableDefs);
    this.assertRequiredFields(editableDefs, submittedEditable, current);
    this.assertRequiredAttachments(
      attachmentsEnabled,
      invitation.vendor.metadata,
      invitation.id.toString(),
    );
    if (isDraft) {
      this.assertDraftFieldValues(submittedEditable);
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

    let assignedVendorCode: string | undefined;
    try {
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

        if (isDraft && isSupplierType(core.supplierType)) {
          // Supplier type drives the permanent code prefix (RM/CS/SP/ES), replacing the DR### placeholder.
          assignedVendorCode = await this.vendorsRepository.nextVendorCode(
            companyId,
            SUPPLIER_TYPE_PREFIX[core.supplierType],
            client,
          );
          updateData.supplierType = core.supplierType;
          updateData.vendorCode = assignedVendorCode;
        }

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
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Could not assign a vendor code. Please submit again.');
      }
      throw error;
    }

    const updatedSnapshot = mergeFieldSnapshotAfterSubmit(current, submittedEditable);
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
        ...(assignedVendorCode ? { registrationCompleted: true, vendorCode: assignedVendorCode } : {}),
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

        const emailContent = buildVendorFormInviteEmail({
          ...this.emailBranding(invitation.company),
          vendorName: this.emailVendorName(invitation.vendor),
          formUrl: this.buildFormUrl(rawToken),
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

  private async issueInvitation(
    vendor: Vendor,
    company: InvitationCompany,
    dto: GenerateVendorEmailDto,
    actorId: string,
  ) {
    const companyId = vendor.companyId.toString();
    const vendorId = vendor.vendorId.toString();
    const isDraft = isDraftVendorCode(vendor.vendorCode);

    const fieldDefs = await this.resolveFieldDefinitions(companyId, isDraft);
    const customFields = await this.loadCustomFields(companyId, vendorId);
    const vendorRecord = serialize(vendor) as Record<string, unknown>;
    const builtSnapshot = buildFieldSnapshot(vendorRecord, customFields, fieldDefs);
    const fieldSnapshot = isDraft ? blankDraftVendorSnapshot(builtSnapshot) : builtSnapshot;

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
      ...this.emailBranding(company),
      vendorName: this.emailVendorName(vendor),
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
        registrationDraft: isDraft,
        emailSent: emailResult.sent,
        emailStub: emailResult.stub ?? false,
      },
    });

    return serialize({
      invitationId: invitation.id,
      vendorId,
      status: VendorFormInvitationStatus.SENT,
      sendCount: 1,
      maxSendCount: dto.maxSendCount,
      formInvitation: {
        status: VendorFormInvitationStatus.SENT,
        sendCount: 1,
        maxSendCount: dto.maxSendCount,
        submittedAt: null,
      },
      recipientEmail: dto.toEmail,
      generatedAt: now,
      expiresAt,
      lastSentAt: now,
      nextReminderAt,
      emailSent: emailResult.sent,
      emailStub: emailResult.stub ?? false,
      ...(emailResult.stub ? { formUrl } : {}),
    });
  }

  /** Only fields the vendor can see and edit are required; omitted keys fall back to the saved value. */
  private assertRequiredFields(
    editableDefs: Map<string, VendorFormFieldDefinition>,
    submitted: Record<string, unknown>,
    current: VendorFormFieldSnapshotMap,
  ) {
    const errors = [...editableDefs.values()]
      .filter((field) => field.required)
      .filter((field) =>
        isFieldEmpty(field.key in submitted ? submitted[field.key] : current[field.key]?.value),
      )
      .map((field) => ({ field: `fields.${field.key}`, message: `${field.label} is required` }));

    if (errors.length > 0) {
      throw new BusinessException(
        errors.length === 1 ? errors[0].message : 'Please fill in all required fields',
        HttpStatus.BAD_REQUEST,
        errors,
        VENDOR_FORM_ERROR_CODES.REQUIRED_FIELD,
      );
    }
  }

  private assertDraftFieldValues(submitted: Record<string, unknown>) {
    const name = submitted[VENDOR_NAME_FIELD_KEY];
    if (typeof name === 'string' && name.length > 200) {
      this.throwInvalidField(VENDOR_NAME_FIELD_KEY, 'Supplier Name must be at most 200 characters');
    }
    if (!isSupplierType(submitted[SUPPLIER_TYPE_FIELD_KEY])) {
      this.throwInvalidField(SUPPLIER_TYPE_FIELD_KEY, 'Supplier type is not valid');
    }
  }

  /** Same E.164 storage as Add Vendor; blank clears the number. */
  private normalizeBuiltInPhones(
    submitted: Record<string, unknown>,
    editableDefs: Map<string, VendorFormFieldDefinition>,
  ) {
    for (const key of BUILT_IN_PHONE_FIELD_KEYS) {
      if (!(key in submitted)) continue;
      const raw = submitted[key];
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        submitted[key] = '';
        continue;
      }
      const normalized = normalizePhoneNumber(String(raw));
      if (!normalized) {
        const label = editableDefs.get(key)?.label ?? key;
        this.throwInvalidField(key, `${label} is not a valid phone number`);
      }
      submitted[key] = normalized;
    }
  }

  /** Every file is checked before any is stored, so a bad file never leaves a partial upload. */
  private validateAttachmentFiles(files: UploadedVendorFormFile[]) {
    if (!files.length) {
      throw new BusinessException(
        'Please choose a file to upload',
        HttpStatus.BAD_REQUEST,
        undefined,
        VENDOR_FORM_ERROR_CODES.ATTACHMENT_EMPTY,
      );
    }

    return files.map((file) => {
      const name = file.originalname || 'File';
      if (!file.buffer?.length) {
        throw new BusinessException(
          `${name} is empty`,
          HttpStatus.BAD_REQUEST,
          undefined,
          VENDOR_FORM_ERROR_CODES.ATTACHMENT_EMPTY,
        );
      }
      if (file.buffer.length > VENDOR_FORM_ATTACHMENT_MAX_BYTES) {
        throw new BusinessException(
          `${name} is larger than 10 MB`,
          HttpStatus.BAD_REQUEST,
          undefined,
          VENDOR_FORM_ERROR_CODES.ATTACHMENT_TOO_LARGE,
        );
      }
      const mimeType = detectVendorFormAttachmentMime(name, file.buffer);
      if (!mimeType) {
        throw new BusinessException(
          `${name} — file type not allowed`,
          HttpStatus.BAD_REQUEST,
          undefined,
          VENDOR_FORM_ERROR_CODES.ATTACHMENT_TYPE,
        );
      }
      return { file, mimeType };
    });
  }

  private assertAttachmentCount(total: number) {
    if (total > VENDOR_FORM_ATTACHMENT_MAX_FILES) {
      throw new BusinessException(
        `You can upload up to ${VENDOR_FORM_ATTACHMENT_MAX_FILES} files`,
        HttpStatus.BAD_REQUEST,
        undefined,
        VENDOR_FORM_ERROR_CODES.ATTACHMENT_LIMIT,
      );
    }
  }

  private assertRequiredAttachments(
    attachmentsEnabled: boolean,
    metadata: unknown,
    invitationId: string,
  ) {
    const { required } = buildAttachmentsBlock(attachmentsEnabled, []);
    if (!required || invitationAttachments(metadata, invitationId).length > 0) return;

    const message = 'Please upload at least one document';
    throw new BusinessException(
      message,
      HttpStatus.BAD_REQUEST,
      [{ field: 'attachments', message }],
      VENDOR_FORM_ERROR_CODES.REQUIRED_FIELD,
    );
  }

  /**
   * Read-modify-write of vendor.metadata.attachments under a row lock, so parallel uploads
   * from the same link cannot drop each other's entries. Returns this invitation's files.
   */
  private async updateVendorAttachments(
    vendorId: bigint,
    invitationId: string,
    mutate: (attachments: unknown[]) => unknown[],
  ): Promise<VendorLinkAttachment[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT vendor_id FROM vendors WHERE vendor_id = ${vendorId} FOR UPDATE`;
      const vendor = await tx.vendor.findUniqueOrThrow({
        where: { vendorId },
        select: { metadata: true },
      });
      const metadata = metadataObject(vendor.metadata);
      const attachments = mutate(vendorAttachmentsFromRecord({ metadata }));
      await tx.vendor.update({
        where: { vendorId },
        data: {
          metadata: { ...metadata, attachments } as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });
      return invitationAttachments({ attachments }, invitationId);
    });
  }

  private async discardUploadedFiles(
    companyId: string,
    vendorId: string,
    files: VendorLinkAttachment[],
  ) {
    for (const file of files) {
      await this.storageService
        .deleteFile(companyId, file.fileAssetId, { entityType: 'vendor', entityId: vendorId })
        .catch((error) =>
          this.logger.warn(
            `Could not remove vendor link upload ${file.fileAssetId}: ${
              error instanceof Error ? error.message : error
            }`,
          ),
        );
    }
  }

  private throwInvalidField(key: string, message: string): never {
    throw new BusinessException(
      message,
      HttpStatus.BAD_REQUEST,
      [{ field: `fields.${key}`, message }],
      VENDOR_FORM_ERROR_CODES.INVALID_FIELD,
    );
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

  private async resolveFieldDefinitions(
    companyId: string,
    isDraft = false,
  ): Promise<VendorFormFieldDefinition[]> {
    return (await this.loadRegistrationForm(companyId, isDraft)).fieldDefs;
  }

  /** Fields and the attachments switch share the company's per-tab registration settings. */
  private async loadRegistrationForm(
    companyId: string,
    isDraft = false,
  ): Promise<{ fieldDefs: VendorFormFieldDefinition[]; attachmentsEnabled: boolean }> {
    const overrides = await this.formConfigurationService.loadFieldOverrides(companyId, 'vendor');
    const builtIn = filterRegistrationBuiltInFields(
      getBuiltInFields('vendor'),
      overrides.visibility,
      overrides.registration,
    );

    const definitions = await this.customFieldsRepository.findDefinitionsByCompany(
      companyId,
      'vendor',
      false,
    );
    const custom = definitions
      .filter((d) => resolveCustomRegistrationVisibility(d))
      .map(mapCustomToFormField);

    const isRegistrationTab = await this.tabAccessService.getRegistrationSectionFilter(
      companyId,
      'vendor',
    );
    const all = sortVendorFormFields(
      [...builtIn, ...custom].filter((field) => isRegistrationTab(field.sectionKey)),
    );
    return {
      fieldDefs: isDraft ? applyDraftVendorFieldRules(all) : all,
      attachmentsEnabled: isRegistrationTab('attachments'),
    };
  }

  /** Values are read when the link is opened, so later staff edits and newly shown fields are pre-filled. */
  private async currentFieldSnapshot(
    vendor: Vendor,
    fieldDefs: VendorFormFieldDefinition[],
    isDraft: boolean,
  ): Promise<VendorFormFieldSnapshotMap> {
    const customFields = await this.loadCustomFields(
      vendor.companyId.toString(),
      vendor.vendorId.toString(),
    );
    const vendorRecord = serialize(vendor) as Record<string, unknown>;
    const snapshot = buildFieldSnapshot(vendorRecord, customFields, fieldDefs);
    return isDraft ? blankDraftVendorSnapshot(snapshot) : snapshot;
  }

  private async loadCompany(companyId: string): Promise<InvitationCompany> {
    const company = await this.prisma.company.findFirst({
      where: { companyId: BigInt(companyId), deletedAt: null },
      select: INVITATION_COMPANY_SELECT,
    });
    if (!company) throw new NotFoundException('Company');
    return company;
  }

  private async loadCustomFields(companyId: string, vendorId: string) {
    const maps = await this.customFieldsValuesService.loadCustomFieldsMapsForRecords(
      companyId,
      'vendor',
      [BigInt(vendorId)],
    );
    return maps.get(vendorId) ?? {};
  }

  private async publicCompany(company: InvitationCompany) {
    return { companyName: company.name, logoUrl: await this.browserLogoUrl(company.logoUrl) };
  }

  /**
   * A logo the vendor's browser can load without login: frontend paths and external https
   * URLs as stored; objects in our private bucket as signed URLs valid for the link lifetime.
   */
  private async browserLogoUrl(raw: string | null): Promise<string | null> {
    const value = raw?.trim();
    if (!value) return null;
    if (value.startsWith('/')) return value;
    const url = await this.storageService.resolveReadableUrl(
      value,
      VENDOR_FORM_TTL_HOURS * 60 * 60,
    );
    return url && /^https:\/\//i.test(url) ? url : null;
  }

  private emailVendorName(vendor: Pick<Vendor, 'name' | 'vendorCode'>): string {
    return isDraftVendorCode(vendor.vendorCode) ? 'Vendor' : vendor.name;
  }

  private emailBranding(company: InvitationCompany) {
    return {
      companyName: company.name,
      companyEmail: company.email,
      companyPhone: company.phone,
      logoUrl: this.absoluteUrl(company.logoUrl),
    };
  }

  /** Email clients cannot resolve relative paths, so relative logos are served from the frontend. */
  private absoluteUrl(raw: string | null): string | null {
    const value = raw?.trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/')) return `${this.frontendOrigin()}${value}`;
    return null;
  }

  private frontendOrigin(): string {
    const origin =
      this.configService.get<string>('app.frontendOrigin') ??
      process.env.FRONTEND_ORIGIN ??
      'http://localhost:3001';
    return origin.replace(/\/$/, '');
  }

  private buildFormUrl(rawToken: string): string {
    return `${this.frontendOrigin()}/vendor-form/${rawToken}`;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
