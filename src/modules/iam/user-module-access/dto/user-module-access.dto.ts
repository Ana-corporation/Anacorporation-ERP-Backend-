import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const moduleAccessTypeSchema = z.enum(['grant', 'deny']);

export const CreateUserModuleAccessSchema = z.object({
  moduleId: z.string().min(1),
  accessType: moduleAccessTypeSchema.optional().default('grant'),
  reason: z.string().max(255).optional(),
  expiryDate: z.string().date().optional(),
});

export const UpdateUserModuleAccessSchema = z.object({
  accessType: moduleAccessTypeSchema.optional(),
  reason: z.string().max(255).optional().nullable(),
  expiryDate: z.string().date().optional().nullable(),
});

export class CreateUserModuleAccessDto extends createZodDto(CreateUserModuleAccessSchema) {}
export class UpdateUserModuleAccessDto extends createZodDto(UpdateUserModuleAccessSchema) {}
