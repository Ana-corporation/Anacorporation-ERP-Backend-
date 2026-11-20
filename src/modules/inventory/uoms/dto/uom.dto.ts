import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** NOS, KG, MTR, SQ.M, L/HR — trimmed + uppercased. */
export const uomCodeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.string().regex(/^[A-Z0-9][A-Z0-9._/-]{0,19}$/, 'Use up to 20 letters/digits (. _ / - allowed)'),
);

export const CreateUomSchema = z.object({
  code: uomCodeSchema,
  name: z.string().trim().min(1).max(80),
  isActive: z.boolean().optional().default(true),
});

export const UpdateUomSchema = z.object({
  code: uomCodeSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
});

export class CreateUomDto extends createZodDto(CreateUomSchema) {}
export class UpdateUomDto extends createZodDto(UpdateUomSchema) {}
