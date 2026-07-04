import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const CreateUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(1).max(100),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  mobile: z.string().optional(),
  password: z.string().min(8),
});

export const UpdateUserSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  mobile: z.string().optional(),
  timeZone: z.string().optional(),
});

export const AssignUserRoleSchema = z.object({
  roleId: bigintIdSchema,
});

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
export class AssignUserRoleDto extends createZodDto(AssignUserRoleSchema) {}
