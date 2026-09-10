import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const CreateStorageBinSchema = z
  .object({
    inventoryLocationId: bigintIdSchema.optional(),
    warehouseId: bigintIdSchema.optional(),
    binCode: z.string().min(1).max(50),
    binName: z.string().max(150).optional(),
    isActive: z.boolean().optional().default(true),
  })
  .refine((data) => Boolean(data.inventoryLocationId || data.warehouseId), {
    message: 'inventoryLocationId or warehouseId is required',
    path: ['warehouseId'],
  });

export const UpdateStorageBinSchema = z.object({
  binCode: z.string().min(1).max(50).optional(),
  binName: z.string().max(150).optional().nullable(),
  isActive: z.boolean().optional(),
});

export class CreateStorageBinDto extends createZodDto(CreateStorageBinSchema) {}
export class UpdateStorageBinDto extends createZodDto(UpdateStorageBinSchema) {}
