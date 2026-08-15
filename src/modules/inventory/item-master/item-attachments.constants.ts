/** Item Master attachment upload limits (FE feed 2026-08-13). */
export const ITEM_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const ITEM_ATTACHMENT_ALLOWED_MIME = new Set([
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

export function resolveItemAttachmentMime(
  originalName: string,
  mimeType?: string,
): string | null {
  const normalized = (mimeType ?? '').trim().toLowerCase();
  if (normalized && ITEM_ATTACHMENT_ALLOWED_MIME.has(normalized)) {
    return normalized;
  }

  const ext = originalName.split('.').pop()?.trim().toLowerCase() ?? '';
  const fromExt = EXT_TO_MIME[ext];
  return fromExt && ITEM_ATTACHMENT_ALLOWED_MIME.has(fromExt) ? fromExt : null;
}
