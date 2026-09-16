import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(StorageService.name);

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
    } catch (error) {
      this.logger.error(
        `GCS upload failed for key=${storageKey} bucket=${bucket}`,
        error instanceof Error ? error.stack : error,
      );
      await this.prisma.fileAsset.update({
        where: { id: fileAsset.id },
        data: { status: FileStatus.FAILED },
      });
      throw new Error(
        error instanceof Error ? `File upload failed: ${error.message}` : 'File upload failed',
      );
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

  async getSignedUrl(organizationId: string, fileId: string, expiresInSeconds = 3600) {
    const file = await this.findFile(organizationId, fileId);
    if (!file) return null;
    return this.storageProvider.getSignedUrl({ key: file.storageKey, expiresInSeconds });
  }

  /**
   * Private GCS buckets cannot serve storage.googleapis.com/... URLs in the browser.
   * Convert a stored durable URL to a short-lived signed URL when it belongs to our bucket.
   */
  async resolveReadableUrl(
    storedUrl: string | null | undefined,
    expiresInSeconds = 7 * 24 * 3600,
  ): Promise<string | null> {
    if (!storedUrl) return null;
    const key = this.extractGcsObjectKey(storedUrl);
    if (!key) return storedUrl;
    try {
      return await this.storageProvider.getSignedUrl({ key, expiresInSeconds });
    } catch (error) {
      this.logger.warn(
        `Failed to sign GCS URL for key=${key}`,
        error instanceof Error ? error.message : error,
      );
      return storedUrl;
    }
  }

  private extractGcsObjectKey(storedUrl: string): string | null {
    const bucket = this.configService.get<string>('gcs.bucket') || 'erp-files';
    const prefixes = [
      `https://storage.googleapis.com/${bucket}/`,
      `https://storage.cloud.google.com/${bucket}/`,
      `gs://${bucket}/`,
    ];
    const publicBaseUrl = this.configService.get<string>('gcs.publicBaseUrl');
    if (publicBaseUrl) {
      prefixes.push(`${publicBaseUrl.replace(/\/$/, '')}/`);
    }
    for (const prefix of prefixes) {
      if (storedUrl.startsWith(prefix)) {
        return decodeURIComponent(storedUrl.slice(prefix.length).split('?')[0]);
      }
    }
    return null;
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
