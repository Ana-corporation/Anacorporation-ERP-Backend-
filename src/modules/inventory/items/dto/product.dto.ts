import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const CreateProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  categoryId: bigintIdSchema.optional(),
  description: z.string().optional(),
  unitOfMeasure: z.string().optional().default('EA'),
  unitCost: z.coerce.number().min(0).optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  isManufactured: z.boolean().optional(),
  isPurchasable: z.boolean().optional(),
  isSaleable: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateProductSchema = z.object({
  name: z.string().min(1).optional(),
  categoryId: bigintIdSchema.optional(),
  description: z.string().optional(),
  unitOfMeasure: z.string().optional(),
  unitCost: z.coerce.number().min(0).optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  isActive: z.boolean().optional(),
  isManufactured: z.boolean().optional(),
  isPurchasable: z.boolean().optional(),
  isSaleable: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export class CreateProductDto extends createZodDto(CreateProductSchema) {}
export class UpdateProductDto extends createZodDto(UpdateProductSchema) {}
