/** Vendor attachment upload limits — same as Item Master (FE feed 2026-09-11). */
export const VENDOR_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const VENDOR_ATTACHMENT_ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXT_TO_MIME: Record<string, string> = {
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

export function resolveVendorAttachmentMime(
  originalName: string,
  mimeType?: string,
): string | null {
  const normalized = (mimeType ?? '').trim().toLowerCase();
  if (normalized && VENDOR_ATTACHMENT_ALLOWED_MIME.has(normalized)) {
    return normalized;
  }

  const ext = originalName.split('.').pop()?.trim().toLowerCase() ?? '';
  const fromExt = EXT_TO_MIME[ext];
  return fromExt && VENDOR_ATTACHMENT_ALLOWED_MIME.has(fromExt) ? fromExt : null;
}

export function vendorAttachmentsFromRecord(vendor: Record<string, unknown>): unknown[] {
  if (Array.isArray(vendor.attachments)) return vendor.attachments;
  if (Array.isArray(vendor.attachmentsJson)) return vendor.attachmentsJson;

  const metadata = vendor.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const nested = (metadata as Record<string, unknown>).attachments;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

export function withVendorAttachmentAliases<T extends Record<string, unknown>>(vendor: T) {
  const attachments = vendorAttachmentsFromRecord(vendor);
  const metadata =
    vendor.metadata && typeof vendor.metadata === 'object' && !Array.isArray(vendor.metadata)
      ? { ...(vendor.metadata as Record<string, unknown>), attachments }
      : attachments.length > 0
        ? { attachments }
        : vendor.metadata;

  return {
    ...vendor,
    metadata,
    attachments,
    attachmentsJson: attachments,
  };
}
