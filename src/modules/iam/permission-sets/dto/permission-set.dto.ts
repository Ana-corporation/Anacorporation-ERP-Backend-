import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const CreatePermissionSetSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  description: z.string().optional(),
  isActive: z.boolean().optional().default(true),
  permissionCodes: z.array(z.string().trim().min(1)).default([]),
});

export const UpdatePermissionSetSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  permissionCodes: z.array(z.string().trim().min(1)).optional(),
});

export const SetRolePermissionSetsSchema = z.object({
  permissionSetIds: z.array(bigintIdSchema).default([]),
});

export class CreatePermissionSetDto extends createZodDto(CreatePermissionSetSchema) {}
export class UpdatePermissionSetDto extends createZodDto(UpdatePermissionSetSchema) {}
export class SetRolePermissionSetsDto extends createZodDto(SetRolePermissionSetsSchema) {}
