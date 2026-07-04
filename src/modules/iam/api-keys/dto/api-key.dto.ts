import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const apiKeyStatusSchema = z.enum(['active', 'revoked', 'expired']);

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  scope: z.string().max(255).optional(),
  expiryDate: z.string().datetime().optional(),
});

export const UpdateApiKeySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  scope: z.string().max(255).optional(),
  status: apiKeyStatusSchema.optional(),
  expiryDate: z.string().datetime().optional().nullable(),
});

export class CreateApiKeyDto extends createZodDto(CreateApiKeySchema) {}
export class UpdateApiKeyDto extends createZodDto(UpdateApiKeySchema) {}
