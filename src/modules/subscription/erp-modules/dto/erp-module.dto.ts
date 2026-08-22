import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const moduleLifecycleStatusSchema = z.enum([
  'DEVELOPMENT',
  'TESTING',
  'INTERNAL',
  'AVAILABLE',
  'DEPRECATED',
  'DISABLED',
]);

export const moduleTypeSchema = z.enum(['admin', 'product']);

export const CreateErpModuleSchema = z.object({
  moduleCode: z.string().min(1).max(40),
  moduleName: z.string().min(1).max(120),
  description: z.string().optional(),
  icon: z.string().max(80).optional(),
  parentModuleId: bigintIdSchema.optional(),
  sortOrder: z.coerce.number().int().optional().default(0),
  moduleType: moduleTypeSchema.optional().default('product'),
  lifecycleStatus: moduleLifecycleStatusSchema.optional().default('DEVELOPMENT'),
  isActive: z.boolean().optional().default(true),
});

export const UpdateErpModuleSchema = z.object({
  moduleName: z.string().min(1).max(120).optional(),
  description: z.string().optional(),
  icon: z.string().max(80).optional(),
  parentModuleId: bigintIdSchema.optional().nullable(),
  sortOrder: z.coerce.number().int().optional(),
  moduleType: moduleTypeSchema.optional(),
  lifecycleStatus: moduleLifecycleStatusSchema.optional(),
  isActive: z.boolean().optional(),
});

export class CreateErpModuleDto extends createZodDto(CreateErpModuleSchema) {}
export class UpdateErpModuleDto extends createZodDto(UpdateErpModuleSchema) {}
