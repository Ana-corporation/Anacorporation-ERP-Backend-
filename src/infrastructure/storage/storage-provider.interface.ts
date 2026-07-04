export interface UploadFileOptions {
  key: string;
  buffer: Buffer;
  mimeType: string;
  metadata?: Record<string, string>;
}

export interface UploadFileResult {
  key: string;
  url: string;
  bucket: string;
}

export interface SignedUrlOptions {
  key: string;
  expiresInSeconds?: number;
}

export abstract class StorageProvider {
  abstract upload(options: UploadFileOptions): Promise<UploadFileResult>;
  abstract delete(key: string): Promise<void>;
  abstract getSignedUrl(options: SignedUrlOptions): Promise<string>;
  abstract getPublicUrl(key: string): string;
}
