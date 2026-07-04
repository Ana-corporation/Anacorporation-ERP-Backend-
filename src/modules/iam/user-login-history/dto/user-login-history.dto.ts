import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const loginResultSchema = z.enum(['success', 'failure']);

export const CreateUserLoginHistorySchema = z.object({
  companyId: z.string().min(1).optional().nullable(),
  loginDate: z.string().datetime().optional(),
  loginResult: loginResultSchema,
  failureReason: z.string().max(150).optional(),
  ipAddress: z.string().optional(),
  browser: z.string().max(80).optional(),
  device: z.string().max(120).optional(),
  country: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  sessionDuration: z.number().int().optional(),
});

export class CreateUserLoginHistoryDto extends createZodDto(CreateUserLoginHistorySchema) {}
