import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function generateVendorFormToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashVendorFormToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensMatch(rawToken: string, storedHash: string): boolean {
  const computed = hashVendorFormToken(rawToken);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
