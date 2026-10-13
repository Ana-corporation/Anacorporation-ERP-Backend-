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

export const BIN_BULK_LIMIT = 500;

/** Size limit (BIN_BULK_LIMIT) and in-request duplicates are checked in the service to return error codes. */
export const BulkCreateStorageBinsSchema = z
  .object({
    inventoryLocationId: bigintIdSchema.optional(),
    warehouseId: bigintIdSchema.optional(),
    bins: z
      .array(
        z.object({
          binCode: z.string().trim().min(1).max(50),
          binName: z.string().max(150).optional(),
          isActive: z.boolean().optional().default(true),
        }),
      )
      .min(1),
    skipExisting: z.boolean().optional().default(false),
  })
  .refine((data) => Boolean(data.inventoryLocationId || data.warehouseId), {
    message: 'inventoryLocationId or warehouseId is required',
    path: ['warehouseId'],
  });

export class CreateStorageBinDto extends createZodDto(CreateStorageBinSchema) {}
export class BulkCreateStorageBinsDto extends createZodDto(BulkCreateStorageBinsSchema) {}
export class UpdateStorageBinDto extends createZodDto(UpdateStorageBinSchema) {}
