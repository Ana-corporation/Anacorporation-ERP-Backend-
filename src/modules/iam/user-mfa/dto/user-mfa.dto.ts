import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const mfaTypeSchema = z.enum(['totp', 'sms', 'email', 'webauthn']);

export const CreateUserMfaSchema = z.object({
  mfaType: mfaTypeSchema,
  secret: z.string().max(255).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(255).optional(),
  isPrimary: z.boolean().optional().default(false),
  isEnabled: z.boolean().optional().default(true),
  verifiedAt: z.string().datetime().optional(),
  recoveryCodes: z.string().optional(),
});

export const UpdateUserMfaSchema = z.object({
  secret: z.string().max(255).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  isPrimary: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  verifiedAt: z.string().datetime().optional().nullable(),
  recoveryCodes: z.string().optional().nullable(),
});

export class CreateUserMfaDto extends createZodDto(CreateUserMfaSchema) {}
export class UpdateUserMfaDto extends createZodDto(UpdateUserMfaSchema) {}
