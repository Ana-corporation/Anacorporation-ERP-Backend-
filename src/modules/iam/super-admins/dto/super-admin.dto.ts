import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { passwordSchema } from '@/common/zod/common.schemas';

export const CreateSuperAdminSchema = z.object({
  name: z.string().min(1).max(150),
  email: z.string().email(),
  password: passwordSchema,
  isMfaEnabled: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

export const UpdateSuperAdminSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  email: z.string().email().optional(),
  password: passwordSchema.optional(),
  isMfaEnabled: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const SuperAdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export class CreateSuperAdminDto extends createZodDto(CreateSuperAdminSchema) {}
export class UpdateSuperAdminDto extends createZodDto(UpdateSuperAdminSchema) {}
export class SuperAdminLoginDto extends createZodDto(SuperAdminLoginSchema) {}
