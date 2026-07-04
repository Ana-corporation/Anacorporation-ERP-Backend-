import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const CreateWarehouseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
});

export const CreateInventoryItemSchema = z.object({
  productId: bigintIdSchema,
  warehouseId: bigintIdSchema,
  reorderPoint: z.coerce.number().min(0).optional(),
  reorderQuantity: z.coerce.number().min(0).optional(),
});

export const InventoryTransactionSchema = z.object({
  inventoryItemId: bigintIdSchema,
  type: z.enum(['receipt', 'issue', 'adjustment', 'transfer']),
  quantity: z.coerce.number(),
  referenceType: z.string().optional(),
  referenceId: bigintIdSchema.optional(),
  notes: z.string().optional(),
});

export class CreateWarehouseDto extends createZodDto(CreateWarehouseSchema) {}
export class CreateInventoryItemDto extends createZodDto(CreateInventoryItemSchema) {}
export class InventoryTransactionDto extends createZodDto(InventoryTransactionSchema) {}
