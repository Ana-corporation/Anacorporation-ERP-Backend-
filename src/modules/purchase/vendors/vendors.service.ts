import { Injectable, HttpStatus } from '@nestjs/common';
import { Prisma, UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { extractCfFilters, VendorListQueryDto } from './dto/vendor-list-query.dto';
import {
  VENDOR_ATTACHMENT_MAX_BYTES,
  resolveVendorAttachmentMime,
  withVendorAttachmentAliases,
} from './vendor-attachments.constants';
import { SUPPLIER_TYPE_PREFIX } from './vendor-code.util';
import { VendorsRepository } from './vendors.repository';

type UploadedMulterFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class VendorsService {
  constructor(
    private readonly repository: VendorsRepository,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly customFieldsValuesService: CustomFieldsValuesService,
    private readonly storageService: StorageService,
  ) {}

  async findAll(companyId: string, query: VendorListQueryDto & Record<string, unknown>) {
    const cfFilters = extractCfFilters(query);
    const recordIdFilter = await this.customFieldsValuesService.filterRecordIdsByCustomFields(
      companyId,
      'vendor',
      cfFilters,
    );

    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
      recordIdFilter,
    );

    if (!query.includeCustomFields) {
      const pageResult = serialize(toPaginatedResult(items, total, page, limit));
      const withAudit = await this.auditService.withAuditList(
        pageResult.items as unknown as Record<string, unknown>[],
      );
      return {
        ...pageResult,
        items: withAudit.map((row) => withVendorAttachmentAliases(row)),
      };
    }

    const maps = await this.customFieldsValuesService.loadCustomFieldsMapsForRecords(
      companyId,
      'vendor',
      items.map((v) => v.vendorId),
    );

    const withCf = items.map((item) => ({
      ...serialize(item),
      customFields: maps.get(item.vendorId.toString()) ?? {},
    }));

    const withAudit = await this.auditService.withAuditList(withCf as Record<string, unknown>[]);
    return toPaginatedResult(
      withAudit.map((row) => withVendorAttachmentAliases(row)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string, companyId: string) {
    const vendor = await this.repository.findById(id, companyId);
    if (!vendor) throw new NotFoundException('Vendor');

    const withCustomFields = await this.customFieldsValuesService.mergeEntityWithCustomFields(
      companyId,
      'vendor',
      vendor.vendorId.toString(),
      serialize(vendor) as Record<string, unknown>,
    );

    return this.auditService.withAudit(
      withVendorAttachmentAliases(withCustomFields as Record<string, unknown>),
    );
  }

  async create(companyId: string, dto: CreateVendorDto, actorId: string) {
    const prefix = SUPPLIER_TYPE_PREFIX[dto.supplierType];
    const { customFields, attachments, ...rest } = dto;
    const vendorDto = {
      ...rest,
      metadata: this.mergeMetadata(undefined, rest.metadata, attachments),
    };

    const vendor = await this.prisma.$transaction(async (tx) => {
      const client = tx as unknown as Prisma.TransactionClient;
      const vendorCode = await this.repository.nextVendorCode(companyId, prefix, client);

      if (await this.repository.findByCode(companyId, vendorCode, client)) {
        throw new ConflictException('Vendor code already exists');
      }

      const created = await this.repository.create(
        companyId,
        vendorDto,
        vendorCode,
        actorId,
        client,
      );
      await this.customFieldsValuesService.persistCustomFields(
        companyId,
        'vendor',
        created.vendorId.toString(),
        customFields,
        'create',
        client,
      );
      return created;
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Vendor',
      entityId: vendor.vendorId.toString(),
      newValue: {
        vendorCode: vendor.vendorCode,
        supplierType: vendor.supplierType,
        name: vendor.name,
      },
    });

    return this.findOne(vendor.vendorId.toString(), companyId);
  }

  async update(id: string, companyId: string, dto: UpdateVendorDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) {
      throw new NotFoundException('Vendor');
    }

    const { customFields, attachments, ...rest } = dto;
    const metadataChanged = rest.metadata !== undefined || attachments !== undefined;
    const vendorDto = {
      ...rest,
      ...(metadataChanged
        ? { metadata: this.mergeMetadata(existing.metadata, rest.metadata, attachments) }
        : {}),
    };

    await this.prisma.$transaction(async (tx) => {
      const client = tx as unknown as Prisma.TransactionClient;
      const hasVendorFields = Object.values(vendorDto).some((value) => value !== undefined);
      if (hasVendorFields) {
        await this.repository.update(id, vendorDto, actorId, client);
      }
      if (customFields !== undefined) {
        await this.customFieldsValuesService.persistCustomFields(
          companyId,
          'vendor',
          id,
          customFields,
          'update',
          client,
        );
      }
    });

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Vendor',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.findOne(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    if (!(await this.repository.findById(id, companyId))) {
      throw new NotFoundException('Vendor');
    }

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Vendor',
      entityId: id,
    });

    return { message: 'Vendor deleted' };
  }

  async uploadAttachments(
    vendorId: string,
    companyId: string,
    files: UploadedMulterFile[],
    actorId: string,
  ) {
    await this.assertVendorExists(vendorId, companyId);

    if (!files.length) {
      throw new BusinessException('No files uploaded');
    }

    const attachments: Array<{
      fileAssetId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      storageKey: string;
      publicUrl: string | null;
      attachmentDate: string;
      status: 'uploaded';
    }> = [];

    const today = new Date().toISOString().slice(0, 10);

    for (const file of files) {
      if (!file?.buffer?.length) {
        throw new BusinessException(`Empty file: ${file?.originalname || 'unknown'}`);
      }
      if (file.size > VENDOR_ATTACHMENT_MAX_BYTES) {
        throw new BusinessException(`File too large (max 10 MB): ${file.originalname}`);
      }

      const mimeType = resolveVendorAttachmentMime(file.originalname, file.mimetype);
      if (!mimeType) {
        throw new BusinessException(`Unsupported file type: ${file.originalname}`);
      }

      try {
        const asset = await this.storageService.uploadFile({
          organizationId: companyId,
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType,
          uploadedById: actorId,
          entityType: 'vendor',
          entityId: vendorId,
        });

        attachments.push({
          fileAssetId: asset.id,
          fileName: asset.originalName,
          mimeType: asset.mimeType,
          fileSize: asset.sizeBytes,
          storageKey: asset.storageKey,
          publicUrl: asset.publicUrl,
          attachmentDate: today,
          status: 'uploaded',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'File upload failed';
        throw new BusinessException(
          message.includes('File upload failed') ? 'File upload failed' : message,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'VendorAttachment',
      entityId: vendorId,
      newValue: { uploaded: attachments.map((a) => a.fileAssetId) },
    });

    return { attachments };
  }

  async deleteAttachment(
    vendorId: string,
    companyId: string,
    fileAssetId: string,
    actorId: string,
  ) {
    await this.assertVendorExists(vendorId, companyId);

    const deleted = await this.storageService.deleteFile(companyId, fileAssetId, {
      entityType: 'vendor',
      entityId: vendorId,
    });
    if (!deleted) {
      throw new NotFoundException('Attachment');
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'VendorAttachment',
      entityId: vendorId,
      newValue: { fileAssetId },
    });

    return {
      success: true,
      message: 'Attachment deleted',
      data: null,
    };
  }

  async getAttachmentSignedUrl(vendorId: string, companyId: string, fileAssetId: string) {
    await this.assertVendorExists(vendorId, companyId);

    const file = await this.storageService.findFile(companyId, fileAssetId, {
      entityType: 'vendor',
      entityId: vendorId,
    });
    if (!file) {
      throw new NotFoundException('Attachment');
    }

    const url = await this.storageService.getSignedUrl(companyId, fileAssetId);
    if (!url) {
      throw new NotFoundException('Attachment');
    }

    return { url };
  }

  private async assertVendorExists(id: string, companyId: string) {
    if (!(await this.repository.findById(id, companyId))) {
      throw new NotFoundException('Vendor');
    }
  }

  private mergeMetadata(
    existing: unknown,
    incoming?: Record<string, unknown>,
    attachments?: Array<Record<string, unknown>>,
  ): Record<string, unknown> | undefined {
    const prior =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};

    if (incoming === undefined && attachments === undefined) {
      return Object.keys(prior).length > 0 ? prior : undefined;
    }

    const merged = {
      ...prior,
      ...(incoming ?? {}),
    };
    if (attachments !== undefined) {
      merged.attachments = attachments;
    }
    return merged;
  }
}
