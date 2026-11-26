import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { UOM_CATEGORIES } from '../uom-standards';

/** NOS, KG, MTR — trimmed + uppercased. */
export const uomCodeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.string().regex(/^[A-Z0-9][A-Z0-9._/-]{0,19}$/, 'Use up to 20 letters/digits (. _ / - allowed)'),
);

const decimalPlacesSchema = z.coerce.number().int().min(0).max(6);
const categorySchema = z.enum(UOM_CATEGORIES);

export const CreateUomSchema = z
  .object({
    code: uomCodeSchema,
    name: z.string().trim().min(1).max(80),
    category: categorySchema,
    /** Max qty fraction digits (0–6). */
    decimalPlaces: decimalPlacesSchema.optional(),
    /** Alias of decimalPlaces (spec name). */
    decimalPrecision: decimalPlacesSchema.optional(),
    isActive: z.boolean().optional().default(true),
  })
  .refine((v) => v.decimalPlaces === undefined || v.decimalPrecision === undefined || v.decimalPlaces === v.decimalPrecision, {
    message: 'decimalPlaces and decimalPrecision must match when both are sent',
    path: ['decimalPlaces'],
  });

export const UpdateUomSchema = z
  .object({
    code: uomCodeSchema.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    category: categorySchema.optional(),
    decimalPlaces: decimalPlacesSchema.optional(),
    decimalPrecision: decimalPlacesSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.decimalPlaces === undefined || v.decimalPrecision === undefined || v.decimalPlaces === v.decimalPrecision, {
    message: 'decimalPlaces and decimalPrecision must match when both are sent',
    path: ['decimalPlaces'],
  });

export class CreateUomDto extends createZodDto(CreateUomSchema) {}
export class UpdateUomDto extends createZodDto(UpdateUomSchema) {}

export function resolveDecimalPlaces(dto: { decimalPlaces?: number; decimalPrecision?: number }, fallback = 6): number {
  return dto.decimalPlaces ?? dto.decimalPrecision ?? fallback;
}
