import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStatus } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { StorageProvider } from './storage-provider.interface';
import { GcsStorageProvider } from './gcs-storage.provider';
import { v4 as uuidv4 } from 'uuid';

export interface StoreFileInput {
  organizationId: string;
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  uploadedById?: string;
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class StorageService {
  constructor(
    private readonly storageProvider: StorageProvider,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async uploadFile(input: StoreFileInput) {
    const extension = input.originalName.split('.').pop() || 'bin';
    const storageKey = `${input.organizationId}/${uuidv4()}.${extension}`;
    const bucket = this.configService.get<string>('gcs.bucket') || 'erp-files';

    const fileAsset = await this.prisma.fileAsset.create({
      data: {
        organizationId: input.organizationId,
        fileName: storageKey.split('/').pop()!,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        storageKey,
        bucket,
        status: FileStatus.PENDING,
        entityType: input.entityType,
        entityId: input.entityId,
        uploadedById: input.uploadedById,
      },
    });

    try {
      const result = await this.storageProvider.upload({
        key: storageKey,
        buffer: input.buffer,
        mimeType: input.mimeType,
        metadata: {
          organizationId: input.organizationId,
          fileAssetId: fileAsset.id,
        },
      });

      return this.prisma.fileAsset.update({
        where: { id: fileAsset.id },
        data: {
          status: FileStatus.UPLOADED,
          publicUrl: result.url,
        },
      });
    } catch {
      await this.prisma.fileAsset.update({
        where: { id: fileAsset.id },
        data: { status: FileStatus.FAILED },
      });
      throw new Error('File upload failed');
    }
  }

  async findFile(
    organizationId: string,
    fileId: string,
    opts?: { entityType?: string; entityId?: string },
  ) {
    return this.prisma.fileAsset.findFirst({
      where: {
        id: fileId,
        organizationId,
        deletedAt: null,
        ...(opts?.entityType ? { entityType: opts.entityType } : {}),
        ...(opts?.entityId ? { entityId: opts.entityId } : {}),
      },
    });
  }

  async getSignedUrl(organizationId: string, fileId: string) {
    const file = await this.findFile(organizationId, fileId);
    if (!file) return null;
    return this.storageProvider.getSignedUrl({ key: file.storageKey });
  }

  async deleteFile(
    organizationId: string,
    fileId: string,
    opts?: { entityType?: string; entityId?: string },
  ) {
    const file = await this.findFile(organizationId, fileId, opts);
    if (!file) return null;

    await this.storageProvider.delete(file.storageKey);

    return this.prisma.fileAsset.update({
      where: { id: fileId },
      data: { deletedAt: new Date(), status: FileStatus.DELETED },
    });
  }
}

export const storageProviderFactory = {
  provide: StorageProvider,
  useClass: GcsStorageProvider,
};
