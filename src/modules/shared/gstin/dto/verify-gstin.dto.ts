import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const VerifyGstinSchema = z.object({
  gstin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().min(15).max(15)),
  includeProfile: z.boolean().optional().default(true),
});

export class VerifyGstinDto extends createZodDto(VerifyGstinSchema) {}
