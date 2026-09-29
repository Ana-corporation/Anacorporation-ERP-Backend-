import { vendorAttachmentsFromRecord } from '../vendor-attachments.constants';

export const VENDOR_LINK_ATTACHMENT_SOURCE = 'VENDOR_LINK';
export const VENDOR_FORM_ATTACHMENT_MAX_FILES = 10;
export const VENDOR_FORM_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Per invitation token, on top of the per-IP vendor form limit. */
export const VENDOR_FORM_ATTACHMENT_UPLOADS_PER_WINDOW = 20;
export const VENDOR_FORM_ATTACHMENT_WINDOW_MS = 10 * 60_000;
/** Company setting comes later; until then uploads are optional. */
export const VENDOR_FORM_ATTACHMENTS_REQUIRED = false;

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const VENDOR_FORM_ATTACHMENT_ACCEPT = Object.keys(EXTENSION_MIME).map((ext) => `.${ext}`);

export type VendorLinkAttachment = {
  fileAssetId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  attachmentDate: string;
  uploadedAt: string;
  status: 'uploaded';
  source: typeof VENDOR_LINK_ATTACHMENT_SOURCE;
  uploadedBy: 'Vendor';
  invitationId: string;
};

export type PublicVendorFormAttachment = Pick<
  VendorLinkAttachment,
  'fileAssetId' | 'fileName' | 'fileSize' | 'mimeType' | 'uploadedAt'
>;

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  bytes.every((byte, i) => buffer[offset + i] === byte);

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const CONTENT_MATCHES: Readonly<Record<string, (buffer: Buffer) => boolean>> = {
  'application/pdf': (b) => b.subarray(0, 1024).includes('%PDF-'),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/webp': (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  'application/msword': (b) => startsWith(b, OLE_SIGNATURE),
  'application/vnd.ms-excel': (b) => startsWith(b, OLE_SIGNATURE),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
    startsWith(b, ZIP_SIGNATURE) && b.includes('word/'),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) =>
    startsWith(b, ZIP_SIGNATURE) && b.includes('xl/'),
  'text/csv': (b) =>
    !b.subarray(0, 8192).includes(0) && !startsWith(b, ZIP_SIGNATURE) && !startsWith(b, OLE_SIGNATURE),
};

/**
 * MIME type from the extension, accepted only when the file bytes match it.
 * The browser-sent MIME is ignored: it is client-controlled and inconsistent for CSV.
 */
export function detectVendorFormAttachmentMime(fileName: string, buffer: Buffer): string | null {
  const ext = fileName.split('.').pop()?.trim().toLowerCase() ?? '';
  const mimeType = EXTENSION_MIME[ext];
  if (!mimeType || !fileName.includes('.')) return null;
  return CONTENT_MATCHES[mimeType](buffer) ? mimeType : null;
}

export function isVendorLinkAttachment(value: unknown, invitationId: string): value is VendorLinkAttachment {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    row.source === VENDOR_LINK_ATTACHMENT_SOURCE &&
    String(row.invitationId ?? '') === invitationId &&
    typeof row.fileAssetId === 'string'
  );
}

/** Only files uploaded through this invitation; staff and internal documents never leave the vendor record. */
export function invitationAttachments(metadata: unknown, invitationId: string): VendorLinkAttachment[] {
  return vendorAttachmentsFromRecord({ metadata }).filter((row): row is VendorLinkAttachment =>
    isVendorLinkAttachment(row, invitationId),
  );
}

export function toPublicAttachment(row: VendorLinkAttachment): PublicVendorFormAttachment {
  return {
    fileAssetId: row.fileAssetId,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    uploadedAt: row.uploadedAt,
  };
}

export function buildAttachmentsBlock(enabled: boolean, files: VendorLinkAttachment[]) {
  return {
    enabled,
    required: enabled && VENDOR_FORM_ATTACHMENTS_REQUIRED,
    maxFiles: VENDOR_FORM_ATTACHMENT_MAX_FILES,
    maxBytes: VENDOR_FORM_ATTACHMENT_MAX_BYTES,
    accept: VENDOR_FORM_ATTACHMENT_ACCEPT,
    files: enabled ? files.map(toPublicAttachment) : [],
  };
}

export function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}
