import { HttpStatus, Injectable } from '@nestjs/common';
import { InventoryDocumentStatus, InventoryDocumentType, Prisma, UserAuditAction } from '@prisma/client';
import { BusinessException, NotFoundException } from '@/common/exceptions/business.exception';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { ITEM_ATTACHMENT_MAX_BYTES, resolveItemAttachmentMime } from '@/modules/inventory/item-master/item-attachments.constants';

const ENTITY_TYPE = 'inventory_document';

interface UploadedFile {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

export interface StoredAttachment {
  fileAssetId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
}

/**
 * Count sheets / verification files on an Opening Stock document (same limits and storage as Item
 * Master attachments). Upload is allowed on drafts and posted documents; delete only on drafts.
 */
@Injectable()
export class OpeningStockAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async upload(companyId: string, id: string, files: UploadedFile[], actorId: string) {
    const doc = await this.findDocument(companyId, id);
    if (!files.length) throw new BusinessException('No files uploaded');

    const added: StoredAttachment[] = [];
    for (const file of files) {
      if (!file?.buffer?.length) throw new BusinessException(`Empty file: ${file?.originalname || 'unknown'}`);
      if (file.size > ITEM_ATTACHMENT_MAX_BYTES) throw new BusinessException(`File too large (max 10 MB): ${file.originalname}`);
      const mimeType = resolveItemAttachmentMime(file.originalname, file.mimetype);
      if (!mimeType) throw new BusinessException(`Unsupported file type: ${file.originalname}`);
      const asset = await this.storageService.uploadFile({
        organizationId: companyId,
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType,
        uploadedById: actorId,
        entityType: ENTITY_TYPE,
        entityId: doc.documentId.toString(),
      });
      added.push({
        fileAssetId: asset.id,
        fileName: asset.originalName,
        mimeType: asset.mimeType,
        fileSize: asset.sizeBytes,
        uploadedBy: actorId,
        uploadedAt: new Date().toISOString(),
      });
    }

    const attachments = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ attachments_json: Prisma.JsonValue | null }>>`
        SELECT attachments_json FROM inventory_documents WHERE document_id = ${doc.documentId} FOR UPDATE`;
      const next = [...listOf(row?.attachments_json ?? null), ...added];
      await tx.inventoryDocument.update({
        where: { documentId: doc.documentId },
        data: { attachmentsJson: next as unknown as Prisma.InputJsonValue },
      });
      return next;
    });
    await this.audit(companyId, actorId, UserAuditAction.update, doc.documentId, { attachmentsAdded: added.map((a) => a.fileName) });
    return { attachments };
  }

  async signedUrl(companyId: string, id: string, fileAssetId: string) {
    const doc = await this.findDocument(companyId, id);
    const file = await this.storageService.findFile(companyId, fileAssetId, { entityType: ENTITY_TYPE, entityId: doc.documentId.toString() });
    if (!file) throw new NotFoundException('Attachment');
    const url = await this.storageService.getSignedUrl(companyId, fileAssetId);
    if (!url) throw new NotFoundException('Attachment');
    return { url };
  }

  async remove(companyId: string, id: string, fileAssetId: string, actorId: string) {
    const doc = await this.findDocument(companyId, id);
    if (doc.status !== InventoryDocumentStatus.DRAFT) {
      throw new BusinessException(
        'Attachments of a posted opening stock cannot be deleted',
        HttpStatus.CONFLICT,
        undefined,
        'INVENTORY_DOCUMENT_POSTED',
      );
    }
    const deleted = await this.storageService.deleteFile(companyId, fileAssetId, { entityType: ENTITY_TYPE, entityId: doc.documentId.toString() });
    if (!deleted) throw new NotFoundException('Attachment');
    const attachments = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ attachments_json: Prisma.JsonValue | null }>>`
        SELECT attachments_json FROM inventory_documents WHERE document_id = ${doc.documentId} FOR UPDATE`;
      const next = listOf(row?.attachments_json ?? null).filter((a) => a.fileAssetId !== fileAssetId);
      await tx.inventoryDocument.update({
        where: { documentId: doc.documentId },
        data: { attachmentsJson: next as unknown as Prisma.InputJsonValue },
      });
      return next;
    });
    await this.audit(companyId, actorId, UserAuditAction.delete, doc.documentId, { attachmentRemoved: fileAssetId });
    return { attachments };
  }

  private async findDocument(companyId: string, id: string) {
    const doc = await this.prisma.inventoryDocument.findFirst({
      where: {
        documentId: parseBigIntId(id),
        companyId: parseBigIntId(companyId, 'companyId'),
        documentType: InventoryDocumentType.OPENING_STOCK,
        deletedAt: null,
      },
      select: { documentId: true, status: true },
    });
    if (!doc) throw new NotFoundException('Opening stock');
    return doc;
  }

  private audit(companyId: string, actorId: string, action: UserAuditAction, documentId: bigint, newValue: Record<string, unknown>) {
    return this.auditService.log({
      companyId,
      performedBy: actorId,
      action,
      entityName: `InventoryDocument:${InventoryDocumentType.OPENING_STOCK}`,
      entityId: documentId.toString(),
      newValue,
    });
  }
}

function listOf(value: Prisma.JsonValue | null): StoredAttachment[] {
  return Array.isArray(value) ? (value as unknown as StoredAttachment[]) : [];
}
