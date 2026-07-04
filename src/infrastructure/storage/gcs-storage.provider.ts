import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import {
  SignedUrlOptions,
  StorageProvider,
  UploadFileOptions,
  UploadFileResult,
} from './storage-provider.interface';

@Injectable()
export class GcsStorageProvider extends StorageProvider {
  private readonly logger = new Logger(GcsStorageProvider.name);
  private readonly storage: Storage;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor(private readonly configService: ConfigService) {
    super();
    const projectId = this.configService.get<string>('gcs.projectId');
    const keyFilePath = this.configService.get<string>('gcs.keyFilePath');
    this.bucket = this.configService.get<string>('gcs.bucket') || 'erp-files';
    this.publicBaseUrl = this.configService.get<string>('gcs.publicBaseUrl');

    this.storage = new Storage({
      projectId,
      ...(keyFilePath ? { keyFilename: keyFilePath } : {}),
    });
  }

  async upload(options: UploadFileOptions): Promise<UploadFileResult> {
    const file = this.storage.bucket(this.bucket).file(options.key);

    await file.save(options.buffer, {
      contentType: options.mimeType,
      metadata: { metadata: options.metadata },
      resumable: false,
    });

    return {
      key: options.key,
      url: this.getPublicUrl(options.key),
      bucket: this.bucket,
    };
  }

  async delete(key: string): Promise<void> {
    await this.storage.bucket(this.bucket).file(key).delete({ ignoreNotFound: true });
  }

  async getSignedUrl(options: SignedUrlOptions): Promise<string> {
    const [url] = await this.storage
      .bucket(this.bucket)
      .file(options.key)
      .getSignedUrl({
        action: 'read',
        expires: Date.now() + (options.expiresInSeconds ?? 3600) * 1000,
      });
    return url;
  }

  getPublicUrl(key: string): string {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${key}`;
    }
    return `https://storage.googleapis.com/${this.bucket}/${key}`;
  }
}
