import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Match prisma/shared/payment-terms.prisma column sizes. */
const emptyToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

export const CreatePaymentTermSchema = z.object({
  /** NET30, ADV50, IMMEDIATE … uppercase letters/digits */
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9 _-]+$/, 'Code may only contain letters, digits, spaces, "-" and "_"'),
  name: z.string().trim().min(1).max(100),
  days: z.coerce.number().int().min(0).max(3650).optional().default(0),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(255).optional()),
  isActive: z.boolean().optional(),
});

export const UpdatePaymentTermSchema = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9 _-]+$/, 'Code may only contain letters, digits, spaces, "-" and "_"').optional(),
  name: z.string().trim().min(1).max(100).optional(),
  days: z.coerce.number().int().min(0).max(3650).optional(),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(255).optional()),
  isActive: z.boolean().optional(),
});

export class CreatePaymentTermDto extends createZodDto(CreatePaymentTermSchema) {}
export class UpdatePaymentTermDto extends createZodDto(UpdatePaymentTermSchema) {}
