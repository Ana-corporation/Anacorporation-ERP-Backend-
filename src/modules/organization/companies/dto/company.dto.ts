import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema, companyStatusSchema } from '@/common/zod/common.schemas';

/** Tenant identifier: trim, uppercase, A-Z 0-9 _ - only. Immutable after create. */
export const companyCodeSchema = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined;
    return typeof value === 'string' ? value.trim().toUpperCase() : value;
  },
  z
    .string()
    .max(30)
    .regex(/^[A-Z0-9_-]+$/, 'companyCode may only contain A-Z, 0-9, underscore, and hyphen')
    .optional(),
);

export const CreateCompanySchema = z.object({
  companyCode: companyCodeSchema,
  name: z.string().min(1).max(200),
  country: z.string().trim().min(1, 'country is required').max(100),
  legalName: z.string().max(255).optional(),
  domain: z.string().max(255).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  city: z.string().max(100).optional(),
  logoUrl: z.string().max(500).optional().nullable(),
  timezone: z.string().optional(),
  defaultCurrencyId: bigintIdSchema.optional(),
  status: companyStatusSchema.optional().default('trial'),
});

export const UpdateCompanySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  legalName: z.string().max(255).optional().nullable(),
  domain: z.string().max(255).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  logoUrl: z.string().max(500).optional().nullable(),
  timezone: z.string().optional(),
  defaultCurrencyId: bigintIdSchema.optional().nullable(),
  status: companyStatusSchema.optional(),
  /** Rejected if present — companyCode is immutable after create. */
  companyCode: z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'companyCode cannot be changed',
        });
      }
    }),
});

export const UpdateCompanyStatusSchema = z.object({
  status: companyStatusSchema,
});

export class CreateCompanyDto extends createZodDto(CreateCompanySchema) {}
export class UpdateCompanyDto extends createZodDto(UpdateCompanySchema) {}
export class UpdateCompanyStatusDto extends createZodDto(UpdateCompanyStatusSchema) {}
