import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema, passwordSchema } from '@/common/zod/common.schemas';

export const LoginSchema = z
  .object({
    employeeCode: z.string().min(1),
    password: z.string().min(1),
    companyId: bigintIdSchema.optional(),
    companyCode: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.companyId || data.companyCode), {
    message: 'companyId or companyCode is required',
    path: ['companyId'],
  });

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const SwitchCompanySchema = z.object({
  companyId: bigintIdSchema,
});

export const ResolveCompanySchema = z.object({
  companyCode: z.string().min(1),
});

export const CompanySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  companyCode: z.string(),
  roleName: z.string(),
});

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).optional(),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine(
    (data) => !data.currentPassword || data.newPassword !== data.currentPassword,
    {
      message: 'New password must be different from current password',
      path: ['newPassword'],
    },
  );

export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshTokenDto extends createZodDto(RefreshTokenSchema) {}
export class SwitchCompanyDto extends createZodDto(SwitchCompanySchema) {}
export class CompanySummaryDto extends createZodDto(CompanySummarySchema) {}
export class ResolveCompanyDto extends createZodDto(ResolveCompanySchema) {}
export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
