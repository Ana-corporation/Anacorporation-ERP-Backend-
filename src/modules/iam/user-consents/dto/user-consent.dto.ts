import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const consentTypeSchema = z.enum([
  'privacy_policy',                                                                           
  'terms',
  'nda',
  'marketing',
  'cookies',
]);

export const CreateUserConsentSchema = z.object({
  consentType: consentTypeSchema,
  consentVersion: z.string().min(1).max(20),
  isAccepted: z.boolean().optional().default(false),
  acceptedDate: z.string().datetime().optional(),
  ipAddress: z.string().max(45).optional(),
});

export const UpdateUserConsentSchema = z.object({
  consentVersion: z.string().min(1).max(20).optional(),
  isAccepted: z.boolean().optional(),
  acceptedDate: z.string().datetime().optional().nullable(),
  ipAddress: z.string().max(45).optional().nullable(),
});

export class CreateUserConsentDto extends createZodDto(CreateUserConsentSchema) {}
export class UpdateUserConsentDto extends createZodDto(UpdateUserConsentSchema) {}
