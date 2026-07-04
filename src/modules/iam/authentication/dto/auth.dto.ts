import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema, passwordSchema } from '@/common/zod/common.schemas';

export const SignUpSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  confirmPassword: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().min(1),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  companyId: bigintIdSchema.optional(),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const SwitchCompanySchema = z.object({
  companyId: bigintIdSchema,
});

export const CompanySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  companyCode: z.string(),
  roleName: z.string(),
});

export class SignUpDto extends createZodDto(SignUpSchema) {}
export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshTokenDto extends createZodDto(RefreshTokenSchema) {}
export class SwitchCompanyDto extends createZodDto(SwitchCompanySchema) {}
export class CompanySummaryDto extends createZodDto(CompanySummarySchema) {}
