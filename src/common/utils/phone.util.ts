import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import { z } from 'zod';

/** Default when number has no `+` country code (Ana / India-first product). */
export const DEFAULT_PHONE_COUNTRY: CountryCode = 'IN';

/**
 * Validate and normalize a phone to E.164 (e.g. +919876543210).
 * Returns null when empty/whitespace. Returns null when invalid.
 *
 * Numbers with `+` are parsed internationally (all countries).
 * Numbers without `+` are tried against defaultCountry (IN).
 */
export function normalizePhoneNumber(
  input: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(
    trimmed,
    trimmed.startsWith('+') ? undefined : defaultCountry,
  );
  if (!parsed?.isValid()) return null;
  return parsed.format('E.164');
}

export function isValidPhoneNumber(
  input: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): boolean {
  return normalizePhoneNumber(input, defaultCountry) !== null;
}

const emptyToUndefined = (value: unknown) =>
  value === '' || value === null ? undefined : value;

/** Keep undefined as "omit"; map '' → null for clearable fields. */
const emptyToNull = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === '' || value === null) return null;
  return value;
};

/** Optional phone → E.164 or undefined. Invalid → Zod issue. */
export const optionalPhoneE164Schema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(50)
    .transform((value, ctx) => {
      const normalized = normalizePhoneNumber(value);
      if (!normalized) {
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid phone number for the selected country',
        });
        return z.NEVER;
      }
      return normalized;
    })
    .optional(),
);

/** Optional/nullable phone → E.164, null, or undefined. Invalid → Zod issue. */
export const optionalNullablePhoneE164Schema = z.preprocess(
  emptyToNull,
  z
    .union([
      z.null(),
      z
        .string()
        .trim()
        .max(50)
        .transform((value, ctx) => {
          const normalized = normalizePhoneNumber(value);
          if (!normalized) {
            ctx.addIssue({
              code: 'custom',
              message: 'Invalid phone number for the selected country',
            });
            return z.NEVER;
          }
          return normalized;
        }),
    ])
    .optional(),
);

/** Known Vendor metadata keys that store phone numbers. */
export const VENDOR_METADATA_PHONE_KEYS = ['mobile', 'tel2'] as const;

/**
 * Normalize known phone keys in vendor metadata in place.
 * Throws Error with message suitable for BusinessException when invalid.
 */
export function normalizeVendorMetadataPhones(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;

  const next = { ...metadata };
  for (const key of VENDOR_METADATA_PHONE_KEYS) {
    if (!(key in next) || next[key] === undefined || next[key] === null) continue;
    const raw = String(next[key]).trim();
    if (!raw) {
      next[key] = null;
      continue;
    }
    const normalized = normalizePhoneNumber(raw);
    if (!normalized) {
      throw new Error(`Invalid phone number for metadata.${key}`);
    }
    next[key] = normalized;
  }
  return next;
}
