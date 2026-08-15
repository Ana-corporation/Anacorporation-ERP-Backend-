import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const licenseTypeSchema = z.enum(['named', 'concurrent']);

export const CreateCompanySecurityPolicySchema = z.object({
  passwordExpiryDays: z.coerce.number().int().positive().optional().default(90),
  passwordNeverExpires: z.boolean().optional().default(false),
  forcePasswordRotation: z.boolean().optional().default(false),
  minPasswordLength: z.coerce.number().int().min(4).max(128).optional().default(8),
  requireStrongPassword: z.boolean().optional().default(true),
  requireMfa: z.boolean().optional().default(false),
  maxLoginAttempts: z.coerce.number().int().min(1).max(99).optional().default(5),
  lockoutDurationMin: z.coerce.number().int().positive().optional().default(30),
  allowMultipleLogins: z.boolean().optional().default(true),
  maxConcurrentSessions: z.coerce.number().int().positive().optional(),
  sessionTimeoutMin: z.coerce.number().int().positive().optional().default(480),
  licenseType: licenseTypeSchema.optional().default('named'),
  totalLicenses: z.coerce.number().int().positive().optional(),
});

export const UpdateCompanySecurityPolicySchema = CreateCompanySecurityPolicySchema.partial();

export class CreateCompanySecurityPolicyDto extends createZodDto(CreateCompanySecurityPolicySchema) {}
export class UpdateCompanySecurityPolicyDto extends createZodDto(UpdateCompanySecurityPolicySchema) {}
