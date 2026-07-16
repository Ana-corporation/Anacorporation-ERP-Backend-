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

export const CloneRoleSchema = z.object({
  roleCode: z.string().min(1),
  roleName: z.string().min(1),
  description: z.string().optional(),
});

export const SetRolePermissionsSchema = z
  .object({
    permissionIds: z.array(bigintIdSchema).optional(),
    permissionCodes: z.array(z.string().min(1)).optional(),
    permissions: z
      .array(
        z.object({
          moduleId: bigintIdSchema,
          action: z.string().min(1),
        }),
      )
      .optional(),
  })
  .refine(
    (data) =>
      (data.permissionIds && data.permissionIds.length > 0) ||
      (data.permissionCodes && data.permissionCodes.length > 0) ||
      (data.permissions && data.permissions.length > 0),
    { message: 'permissionIds, permissionCodes, or permissions is required' },
  );

export class CreateRoleDto extends createZodDto(CreateRoleSchema) {}
export class UpdateRoleDto extends createZodDto(UpdateRoleSchema) {}
export class CloneRoleDto extends createZodDto(CloneRoleSchema) {}
export class SetRolePermissionsDto extends createZodDto(SetRolePermissionsSchema) {}
