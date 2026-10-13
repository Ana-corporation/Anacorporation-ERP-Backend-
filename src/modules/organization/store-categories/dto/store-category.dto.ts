import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** 2-6 chars, A-Z / 0-9, starts with a letter. Trimmed + uppercased ("rms " → "RMS"). */
export const codePrefixSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.string().regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Use 2-6 letters/digits, starting with a letter'),
);

const nullableText = (max: number) =>
  z.preprocess((value) => (value === '' ? null : value), z.string().trim().max(max).nullable().optional());

export const CreateStoreCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  codePrefix: codePrefixSchema,
  description: nullableText(255),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const UpdateStoreCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  codePrefix: codePrefixSchema.optional(),
  description: nullableText(255),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export class CreateStoreCategoryDto extends createZodDto(CreateStoreCategorySchema) {}
export class UpdateStoreCategoryDto extends createZodDto(UpdateStoreCategorySchema) {}
