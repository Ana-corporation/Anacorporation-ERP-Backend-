import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';
import { optionalOrgCodeSchema } from '@/common/zod/org-code.schema';

export const WarehouseLocationTypeSchema = z.enum(['Warehouse', 'Store', 'Godown', 'Other']);

export const CreateWarehouseSchema = z.object({
  warehouseCode: optionalOrgCodeSchema,
  name: z.string().min(1).max(150),
  branchId: bigintIdSchema,
  address: z.string().max(255).optional(),
  isActive: z.boolean().optional().default(true),
  locationType: WarehouseLocationTypeSchema.optional().default('Store'),
  binManagement: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
});

export const UpdateWarehouseSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  branchId: bigintIdSchema.optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  isActive: z.boolean().optional(),
  locationType: WarehouseLocationTypeSchema.optional(),
  binManagement: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export class CreateWarehouseDto extends createZodDto(CreateWarehouseSchema) {}
export class UpdateWarehouseDto extends createZodDto(UpdateWarehouseSchema) {}
