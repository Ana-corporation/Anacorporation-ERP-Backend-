import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const CreateRoleSchema = z.object({
  roleCode: z.string().min(1),
  roleName: z.string().min(1),
  description: z.string().optional(),
});

export const UpdateRoleSchema = z.object({
  roleName: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const SetRolePermissionsSchema = z.object({
  permissionIds: z.array(bigintIdSchema).min(1),
});

export const RolePermissionItemSchema = z.object({
  permissionId: bigintIdSchema,
  isAllowed: z.boolean().default(true),
});

export class CreateRoleDto extends createZodDto(CreateRoleSchema) {}
export class UpdateRoleDto extends createZodDto(UpdateRoleSchema) {}
export class SetRolePermissionsDto extends createZodDto(SetRolePermissionsSchema) {}
export class RolePermissionItemDto extends createZodDto(RolePermissionItemSchema) {}
