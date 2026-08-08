import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateRoleSchema = z.object({
  roleCode: z.string().trim().min(1).max(40),
  roleName: z.string().trim().min(1).max(120),
  description: z.string().optional(),
});

export const UpdateRoleSchema = z.object({
  roleName: z.string().trim().min(1).max(120).optional(),
  description: z.string().optional(),
});

/** Preferred FE/BE contract — replace all role permissions by code. */
export const SetRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string().trim().min(1)).default([]),
});

export const CloneRoleSchema = z.object({
  roleCode: z.string().trim().min(1).max(40),
  roleName: z.string().trim().min(1).max(120),
  description: z.string().optional(),
});

export class CreateRoleDto extends createZodDto(CreateRoleSchema) {}
export class UpdateRoleDto extends createZodDto(UpdateRoleSchema) {}
export class SetRolePermissionsDto extends createZodDto(SetRolePermissionsSchema) {}
export class CloneRoleDto extends createZodDto(CloneRoleSchema) {}
