import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateCurrencySchema = z.object({
  code: z.string().length(3).describe('ISO currency code, e.g. USD'),
  name: z.string().min(1).describe('Currency name'),
  symbol: z.string().optional(),
  decimalPlaces: z.coerce.number().int().min(0).max(8).optional().default(2),
  isActive: z.boolean().optional().default(true),
});

export const UpdateCurrencySchema = z.object({
  name: z.string().min(1).optional(),
  symbol: z.string().optional(),
  decimalPlaces: z.coerce.number().int().min(0).max(8).optional(),
  isActive: z.boolean().optional(),
});

export class CreateCurrencyDto extends createZodDto(CreateCurrencySchema) {}
export class UpdateCurrencyDto extends createZodDto(UpdateCurrencySchema) {}
