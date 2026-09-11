export const USER_AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export const USER_AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function resolveAvatarMime(originalName: string, mimeType?: string): string | null {
  const ext = originalName.split('.').pop()?.trim().toLowerCase() ?? '';
  if (ext === 'svg' || ext === 'exe' || ext === 'js' || ext === 'html') {
    return null;
  }

  const normalized = (mimeType ?? '').trim().toLowerCase();
  if (normalized === 'image/svg+xml' || normalized.includes('svg')) {
    return null;
  }
  if (normalized && USER_AVATAR_ALLOWED_MIME.has(normalized)) {
    return normalized;
  }

  const fromExt = EXT_TO_MIME[ext];
  return fromExt && USER_AVATAR_ALLOWED_MIME.has(fromExt) ? fromExt : null;
}

export function avatarLooksLikeMime(buffer: Buffer, mime: string): boolean {
  if (!buffer?.length) return false;
  if (mime === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mime === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}
