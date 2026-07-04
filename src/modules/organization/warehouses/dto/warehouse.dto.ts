import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const CreateWarehouseSchema = z.object({
  warehouseCode: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  branchId: bigintIdSchema.optional(),
  address: z.string().max(255).optional(),
  isActive: z.boolean().optional().default(true),
});

export const UpdateWarehouseSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  branchId: bigintIdSchema.optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  isActive: z.boolean().optional(),
});

export class CreateWarehouseDto extends createZodDto(CreateWarehouseSchema) {}
export class UpdateWarehouseDto extends createZodDto(UpdateWarehouseSchema) {}
