import { HttpStatus, Injectable } from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { DataAccessPoliciesService } from '@/modules/iam/data-access-policies/data-access-policies.service';
import {
  ITEM_ATTACHMENT_MAX_BYTES,
  resolveItemAttachmentMime,
} from './item-attachments.constants';
import {
  CreateItemDto,
  UpdateItemDto,
  UpsertItemWarehouseStockDto,
} from './dto/item.dto';
import { ItemsRepository } from './items.repository';

type UploadedMulterFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class ItemsService {
  constructor(
    private readonly repository: ItemsRepository,
    private readonly auditService: AuditService,
    private readonly dataAccessPoliciesService: DataAccessPoliciesService,
    private readonly storageService: StorageService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto, _userId?: string) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
    );
    const pageResult = serialize(toPaginatedResult(items, total, page, limit));
    const withAudit = await this.auditService.withAuditList(
      pageResult.items as unknown as Record<string, unknown>[],
    );
    return { ...pageResult, items: withAudit };
  }

  async findOne(id: string, companyId: string, userId?: string) {
    const item = await this.repository.findById(id, companyId);
    if (!item) throw new NotFoundException('Item');
    if (userId) {
      const scope = await this.dataAccessPoliciesService.resolveUserDataScope(userId, companyId);
      if (scope.isRestricted) {
        // Empty warehouse union = NO warehouse rows (spec: empty scope ≠ all data)
        item.warehouseStock = item.warehouseStock.filter((row) =>
          scope.warehouseIds.includes(row.warehouseId.toString()),
        );
      }
    }
    return this.auditService.withAudit(serialize(item) as Record<string, unknown>);
  }

  async create(companyId: string, dto: CreateItemDto, actorId: string) {
    await this.assertVendorInCompany(companyId, dto.preferredVendorId);

    const settings = await this.repository.getOrCreateItemSettings(companyId, actorId);
    const mode = settings.itemCodeMode;
    const prefix = settings.itemCodePrefix || 'ITM';

    let itemCode: string;

    if (mode === 'MANUAL') {
      const raw = dto.itemCode?.trim();
      if (!raw) {
        throw new BusinessException(
          'itemCode is required when item code mode is MANUAL',
          HttpStatus.BAD_REQUEST,
          [{ field: 'itemCode', message: 'Item code is required' }],
        );
      }
      itemCode = raw.toUpperCase();
      if (await this.repository.findAnyByCode(companyId, itemCode)) {
        throw new ConflictException('Item code already exists');
      }
    } else {
      // AUTO — backend is sole authority; ignore any client-supplied code
      itemCode = await this.allocateUniqueAutoCode(companyId, prefix);
    }

    let item;
    try {
      item = await this.repository.create(companyId, dto, itemCode, actorId);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Item code already exists');
      }
      throw error;
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Item',
      entityId: item.itemId.toString(),
      newValue: { itemCode: item.itemCode, description: item.description, itemCodeMode: mode },
    });

    return this.auditService.withAudit(serialize(item) as Record<string, unknown>);
  }

  async getItemSettings(companyId: string, actorId?: string) {
    const settings = await this.repository.getOrCreateItemSettings(companyId, actorId);
    return serialize({
      companyId: settings.companyId,
      itemCodeMode: settings.itemCodeMode,
      itemCodePrefix: settings.itemCodePrefix,
      updatedAt: settings.updatedAt,
    });
  }

  async updateItemSettings(
    companyId: string,
    dto: { itemCodeMode: 'AUTO' | 'MANUAL'; itemCodePrefix?: string },
    actorId: string,
  ) {
    const settings = await this.repository.updateItemSettings(companyId, dto, actorId);
    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'CompanyItemSettings',
      entityId: companyId,
      newValue: dto as Record<string, unknown>,
    });
    return serialize({
      companyId: settings.companyId,
      itemCodeMode: settings.itemCodeMode,
      itemCodePrefix: settings.itemCodePrefix,
      updatedAt: settings.updatedAt,
    });
  }

  private async allocateUniqueAutoCode(companyId: string, prefix: string): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = await this.repository.nextAutoItemCode(companyId, prefix);
      if (!(await this.repository.findAnyByCode(companyId, candidate))) {
        return candidate;
      }
    }
    throw new ConflictException('Unable to allocate unique item code');
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  async update(id: string, companyId: string, dto: UpdateItemDto, actorId: string) {
    await this.assertItemExists(id, companyId);
    await this.assertVendorInCompany(companyId, dto.preferredVendorId);

    const item = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Item',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.auditService.withAudit(serialize(item) as Record<string, unknown>);
  }

  async remove(id: string, companyId: string, actorId: string) {
    await this.assertItemExists(id, companyId);
    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Item',
      entityId: id,
    });

    return { message: 'Item deleted' };
  }

  async upsertWarehouseStock(
    id: string,
    companyId: string,
    dto: UpsertItemWarehouseStockDto,
    actorId: string,
  ) {
    await this.assertItemExists(id, companyId);

    const warehouse = await this.repository.findWarehouseById(dto.warehouseId, companyId);
    if (!warehouse) throw new NotFoundException('Warehouse');
    await this.dataAccessPoliciesService.assertWarehouseScope(
      actorId,
      companyId,
      dto.warehouseId,
    );

    const row = await this.repository.upsertWarehouseStock(companyId, id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'ItemWarehouseStock',
      entityId: row.itemWarehouseStockId.toString(),
      newValue: { ...dto },
    });

    return serialize(row);
  }

  async removeWarehouseStock(
    id: string,
    companyId: string,
    warehouseId: string,
    actorId: string,
  ) {
    await this.assertItemExists(id, companyId);
    await this.dataAccessPoliciesService.assertWarehouseScope(actorId, companyId, warehouseId);

    const { count } = await this.repository.deleteWarehouseStock(id, warehouseId);
    if (count === 0) throw new NotFoundException('Item warehouse stock');

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'ItemWarehouseStock',
      entityId: id,
      newValue: { warehouseId },
    });

    return { message: 'Item warehouse stock removed' };
  }

  async uploadAttachments(
    itemId: string,
    companyId: string,
    files: UploadedMulterFile[],
    actorId: string,
  ) {
    await this.assertItemExists(itemId, companyId);

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
      if (file.size > ITEM_ATTACHMENT_MAX_BYTES) {
        throw new BusinessException(`File too large (max 10 MB): ${file.originalname}`);
      }

      const mimeType = resolveItemAttachmentMime(file.originalname, file.mimetype);
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
          entityType: 'item',
          entityId: itemId,
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
      entityName: 'ItemAttachment',
      entityId: itemId,
      newValue: { uploaded: attachments.map((a) => a.fileAssetId) },
    });

    return { attachments };
  }

  async deleteAttachment(
    itemId: string,
    companyId: string,
    fileAssetId: string,
    actorId: string,
  ) {
    await this.assertItemExists(itemId, companyId);

    const deleted = await this.storageService.deleteFile(companyId, fileAssetId, {
      entityType: 'item',
      entityId: itemId,
    });
    if (!deleted) {
      throw new NotFoundException('Attachment');
    }

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'ItemAttachment',
      entityId: itemId,
      newValue: { fileAssetId },
    });

    return {
      success: true,
      message: 'Attachment deleted',
      data: null,
    };
  }

  async getAttachmentSignedUrl(itemId: string, companyId: string, fileAssetId: string) {
    await this.assertItemExists(itemId, companyId);

    const file = await this.storageService.findFile(companyId, fileAssetId, {
      entityType: 'item',
      entityId: itemId,
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

  private async assertItemExists(id: string, companyId: string) {
    if (!(await this.repository.findById(id, companyId))) {
      throw new NotFoundException('Item');
    }
  }

  private async assertVendorInCompany(companyId: string, vendorId?: string) {
    if (!vendorId) return;
    if (!(await this.repository.findVendorById(vendorId, companyId))) {
      throw new NotFoundException('Preferred vendor');
    }
  }
}
