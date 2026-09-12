import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const InviteCompanyUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  mobile: z.string().optional(),
  employeeId: z.string().max(40).optional(),
  roleId: bigintIdSchema.optional(),
  sendInviteEmail: z.boolean().optional().default(true),
  username: z.string().min(1).optional(),
});

export const UpdateCompanyUserProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  mobile: z.string().optional().nullable(),
});

export const SetCompanyUserRoleSchema = z.object({
  roleId: bigintIdSchema,
});

export const UpdateCompanyUserMembershipSchema = z.object({
  employeeId: z.string().max(40).optional().nullable(),
  departmentId: bigintIdSchema.optional().nullable(),
  designationId: bigintIdSchema.optional().nullable(),
  branchId: bigintIdSchema.optional().nullable(),
  warehouseId: bigintIdSchema.optional().nullable(),
});

export const SetCompanyUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

export const SetCompanyUserModuleAccessSchema = z.object({
  items: z
    .array(
      z.object({
        moduleId: bigintIdSchema,
        accessType: z.enum(['grant', 'deny']).nullable(),
      }),
    )
    .min(1),
});

export class InviteCompanyUserDto extends createZodDto(InviteCompanyUserSchema) {}
export class UpdateCompanyUserProfileDto extends createZodDto(UpdateCompanyUserProfileSchema) {}
export class SetCompanyUserRoleDto extends createZodDto(SetCompanyUserRoleSchema) {}
export class UpdateCompanyUserMembershipDto extends createZodDto(
  UpdateCompanyUserMembershipSchema,
) {}
export class SetCompanyUserStatusDto extends createZodDto(SetCompanyUserStatusSchema) {}
export class SetCompanyUserModuleAccessDto extends createZodDto(
  SetCompanyUserModuleAccessSchema,
) {}
