import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8)
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&.#^_-]{8,}$/,
    'Password must be at least 8 characters and include uppercase, lowercase, and a number',
  );

/**
 * Accept digit string OR number (JSON often sends roleId/userId as number from FE selects).
 * Always normalize to string for Prisma bigint helpers.
 */
export const bigintIdSchema = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}, z.string().regex(/^\d+$/, 'Invalid id'));

/** Optional/nullable id — coerces number→string; '' / null / undefined → null. */
export const optionalNullableBigintIdSchema = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.trim();
  return value;
}, z.union([z.string().regex(/^\d+$/, 'Invalid id'), z.null()]).optional());

export const companyStatusSchema = z.enum(['trial', 'active', 'suspended', 'cancelled']);
