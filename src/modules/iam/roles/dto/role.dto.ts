import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

/** Empty / null roleCode → undefined so BE can auto-generate. */
const optionalRoleCodeSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}, z.string().trim().min(1).max(40).optional());

export const CreateRoleSchema = z.object({
  roleCode: optionalRoleCodeSchema,
  roleName: z.string().trim().min(1).max(120),
  description: z.string().optional(),
});

export const UpdateRoleSchema = z.object({
  roleName: z.string().trim().min(1).max(120).optional(),
  description: z.string().optional(),
});

export const SetRolePermissionsSchema = z.object({
  permissionIds: z.array(bigintIdSchema).optional(),
  permissionCodes: z.array(z.string().trim().min(1)).optional().default([]),
  permissions: z
    .array(
      z.object({
        moduleId: bigintIdSchema,
        action: z.string().min(1),
      }),
    )
    .optional(),
});

export const CloneRoleSchema = z.object({
  roleCode: optionalRoleCodeSchema,
  roleName: z.string().trim().min(1).max(120),
  description: z.string().optional(),
});

export const DeleteRoleSchema = z.object({
  reassignToRoleId: z.string().trim().min(1).optional(),
});

export const AssignRolePersonSchema = z.object({
  userId: bigintIdSchema,
});

export const ReassignRolePersonSchema = z
  .object({
    fromUserId: bigintIdSchema.optional(),
    toUserId: bigintIdSchema,
  })
  .refine((v) => Boolean(v.toUserId), { message: 'toUserId is required' });

export const UnassignRolePersonSchema = z.object({
  userId: bigintIdSchema.optional(),
});

export const DeactivateRoleSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export class CreateRoleDto extends createZodDto(CreateRoleSchema) {}
export class UpdateRoleDto extends createZodDto(UpdateRoleSchema) {}
export class CloneRoleDto extends createZodDto(CloneRoleSchema) {}
export class SetRolePermissionsDto extends createZodDto(SetRolePermissionsSchema) {}
export class DeleteRoleDto extends createZodDto(DeleteRoleSchema) {}
export class AssignRolePersonDto extends createZodDto(AssignRolePersonSchema) {}
export class ReassignRolePersonDto extends createZodDto(ReassignRolePersonSchema) {}
export class UnassignRolePersonDto extends createZodDto(UnassignRolePersonSchema) {}
export class DeactivateRoleDto extends createZodDto(DeactivateRoleSchema) {}
