import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ListQuerySchema } from '@/common/dto/pagination.dto';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const StorageBinStatusSchema = z.enum(['ACTIVE', 'BLOCKED', 'INACTIVE']);
export type StorageBinStatus = z.infer<typeof StorageBinStatusSchema>;

/** Bin pickers (e.g. ELS-001 has 200+ bins) need more than the global list max of 200. */
export const STORAGE_BIN_LIST_MAX = 500;

export const StorageBinListQuerySchema = ListQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(STORAGE_BIN_LIST_MAX).optional().default(20),
  /** Prefer binCode for Opening Stock / Transfer pickers (natural-sorted in service). */
  sortBy: z.string().optional().default('binCode'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});
export class StorageBinListQueryDto extends createZodDto(StorageBinListQuerySchema) {}

export const CreateStorageBinSchema = z
  .object({
    inventoryLocationId: bigintIdSchema.optional(),
    warehouseId: bigintIdSchema.optional(),
    binCode: z.string().min(1).max(50),
    binName: z.string().max(150).optional(),
    isActive: z.boolean().optional().default(true),
    status: StorageBinStatusSchema.optional().default('ACTIVE'),
  })
  .refine((data) => Boolean(data.inventoryLocationId || data.warehouseId), {
    message: 'inventoryLocationId or warehouseId is required',
    path: ['warehouseId'],
  });

export const UpdateStorageBinSchema = z.object({
  binCode: z.string().min(1).max(50).optional(),
  binName: z.string().max(150).optional().nullable(),
  isActive: z.boolean().optional(),
  status: StorageBinStatusSchema.optional(),
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
