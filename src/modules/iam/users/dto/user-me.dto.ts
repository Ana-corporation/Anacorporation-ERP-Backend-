import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { BusinessException } from '@/common/exceptions/business.exception';
import { HttpStatus } from '@nestjs/common';

export const SELF_PROFILE_FORBIDDEN_KEYS = [
  'email',
  'employeeCode',
  'employeeId',
  'roleId',
  'departmentId',
  'designationId',
  'warehouseId',
  'status',
  'companyId',
  'permissions',
  'password',
] as const;

const emptyToNull = (value: unknown) =>
  value === '' || value === undefined ? undefined : value === null ? null : value;

export const PatchSelfProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    phone: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.displayName === undefined && value.phone === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide displayName and/or phone',
      });
    }
  });

export const PatchSelfSettingsSchema = z
  .object({
    locale: z.string().trim().min(2).max(15).optional(),
    dateFormat: z.string().trim().min(1).max(30).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.locale === undefined && value.dateFormat === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide locale and/or dateFormat',
      });
    }
  });

export class PatchSelfProfileDto extends createZodDto(PatchSelfProfileSchema) {}
export class PatchSelfSettingsDto extends createZodDto(PatchSelfSettingsSchema) {}

export function rejectForbiddenSelfPatchKeys(body: Record<string, unknown>) {
  const blocked = Object.keys(body).filter((key) =>
    (SELF_PROFILE_FORBIDDEN_KEYS as readonly string[]).includes(key),
  );
  if (blocked.length === 0) return;
  throw new BusinessException(
    'These fields cannot be changed on your profile',
    HttpStatus.UNPROCESSABLE_ENTITY,
    blocked.map((field) => ({
      field,
      message: 'Use the company admin user APIs to change this field',
    })),
  );
}
