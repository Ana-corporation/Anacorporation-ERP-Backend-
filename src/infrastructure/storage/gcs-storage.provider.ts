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
    const keyFilePath =
      this.configService.get<string>('gcs.keyFilePath') ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const credentialsJson = (this.configService.get<string>('gcs.credentialsJson') || '').trim();
    this.bucket = (this.configService.get<string>('gcs.bucket') || '').trim();
    this.publicBaseUrl = this.configService.get<string>('gcs.publicBaseUrl');

    let credentials: Record<string, unknown> | undefined;
    if (credentialsJson) {
      try {
        credentials = JSON.parse(credentialsJson) as Record<string, unknown>;
      } catch {
        this.logger.error('GCS_CREDENTIALS_JSON is not valid JSON — signed avatar URLs will fail');
      }
    }

    const credentialMode = credentials
      ? 'json'
      : keyFilePath
        ? 'keyFile'
        : 'ADC';

    if (!this.bucket) {
      this.logger.error(
        'GCS_BUCKET is not set — avatar/file uploads will fail until it is configured',
      );
    } else {
      this.logger.log(
        `GCS storage ready bucket=${this.bucket} project=${projectId || '(ADC)'} credentials=${credentialMode}`,
      );
    }

    this.storage = new Storage({
      ...(projectId ? { projectId } : {}),
      ...(credentials ? { credentials } : {}),
      ...(!credentials && keyFilePath ? { keyFilename: keyFilePath } : {}),
    });
  }

  async upload(options: UploadFileOptions): Promise<UploadFileResult> {
    if (!this.bucket) {
      throw new Error('GCS_BUCKET is not configured');
    }
    const file = this.storage.bucket(this.bucket).file(options.key);

    try {
      await file.save(options.buffer, {
        contentType: options.mimeType,
        metadata: { metadata: options.metadata },
        resumable: false,
      });
    } catch (error) {
      this.logger.error(
        `GCS upload failed bucket=${this.bucket} key=${options.key}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }

    return {
      key: options.key,
      url: this.getPublicUrl(options.key),
      bucket: this.bucket,
    };
  }

  async delete(key: string): Promise<void> {
    if (!this.bucket) return;
    await this.storage.bucket(this.bucket).file(key).delete({ ignoreNotFound: true });
  }

  async getSignedUrl(options: SignedUrlOptions): Promise<string> {
    if (!this.bucket) {
      throw new Error('GCS_BUCKET is not configured');
    }
    // On Cloud Run (ADC, no private key) this uses IAM signBlob — runtime SA needs
    // roles/iam.serviceAccountTokenCreator on itself + storage access on the bucket.
    const [url] = await this.storage
      .bucket(this.bucket)
      .file(options.key)
      .getSignedUrl({
        version: 'v4',
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
