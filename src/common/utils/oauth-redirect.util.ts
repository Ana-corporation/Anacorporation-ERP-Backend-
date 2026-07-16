import { BadRequestException } from '@nestjs/common';

/** Validates OAuth redirect URIs against an allow-list to prevent open redirects. */
export function assertAllowedRedirectUri(redirectUri: string, allowedUris: string[]): void {
  if (allowedUris.length === 0) {
    throw new BadRequestException(
      'OAuth redirect URIs are not configured. Set OAUTH_ALLOWED_REDIRECT_URIS in environment.',
    );
  }

  const normalized = redirectUri.trim();
  const allowed = allowedUris.some((entry) => entry.trim() === normalized);

  if (!allowed) {
    throw new BadRequestException('OAuth redirect URI is not allowed');
  }
}
