import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8)
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&.#^_-]{8,}$/,
    'Password must be at least 8 characters and include uppercase, lowercase, and a number',
  );

export const bigintIdSchema = z.string().regex(/^\d+$/, 'Invalid id');

export const companyStatusSchema = z.enum(['trial', 'active', 'suspended', 'cancelled']);
