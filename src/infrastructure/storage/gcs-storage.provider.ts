import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
    let resolvedKeyFile = keyFilePath;
    if (credentialsJson) {
      try {
        credentials = JSON.parse(credentialsJson) as Record<string, unknown>;
        // Cloud Run / YAML env escaping often leaves literal "\n" in private_key.
        if (typeof credentials.private_key === 'string') {
          credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }
        // Prefer a real key file — most reliable for V4 signing on Cloud Run.
        const tmpPath = join(tmpdir(), 'erp-gcs-credentials.json');
        writeFileSync(tmpPath, JSON.stringify(credentials), { encoding: 'utf8', mode: 0o600 });
        resolvedKeyFile = tmpPath;
        credentials = undefined;
      } catch {
        this.logger.error('GCS_CREDENTIALS_JSON is not valid JSON — signed avatar URLs will fail');
      }
    }

    const credentialMode = resolvedKeyFile
      ? credentialsJson
        ? 'json-file'
        : 'keyFile'
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
      ...(resolvedKeyFile ? { keyFilename: resolvedKeyFile } : {}),
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
    try {
      const [url] = await this.storage
        .bucket(this.bucket)
        .file(options.key)
        .getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + (options.expiresInSeconds ?? 3600) * 1000,
        });
      return url;
    } catch (error) {
      this.logger.error(
        `GCS getSignedUrl failed bucket=${this.bucket} key=${options.key}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  getPublicUrl(key: string): string {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${key}`;
    }
    return `https://storage.googleapis.com/${this.bucket}/${key}`;
  }
}
