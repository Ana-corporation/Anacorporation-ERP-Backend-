import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';
import { optionalOrgCodeSchema } from '@/common/zod/org-code.schema';

export const CreateDepartmentSchema = z.object({
  departmentCode: optionalOrgCodeSchema,
  name: z.string().min(1).max(150),
  parentDepartmentId: bigintIdSchema.optional(),
  isActive: z.boolean().optional().default(true),
});

export const UpdateDepartmentSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  parentDepartmentId: bigintIdSchema.optional().nullable(),
  isActive: z.boolean().optional(),
});

export class CreateDepartmentDto extends createZodDto(CreateDepartmentSchema) {}
export class UpdateDepartmentDto extends createZodDto(UpdateDepartmentSchema) {}
