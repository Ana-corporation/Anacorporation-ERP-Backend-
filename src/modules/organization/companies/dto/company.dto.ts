import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema, companyStatusSchema } from '@/common/zod/common.schemas';

export const CreateCompanySchema = z.object({
  companyCode: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  legalName: z.string().max(255).optional(),
  domain: z.string().max(255).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  logoUrl: z.string().max(500).optional().nullable(),
  timezone: z.string().optional(),
  defaultCurrencyId: bigintIdSchema.optional(),
  status: companyStatusSchema.optional().default('trial'),
});

export const UpdateCompanySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  legalName: z.string().max(255).optional().nullable(),
  domain: z.string().max(255).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  logoUrl: z.string().max(500).optional().nullable(),
  timezone: z.string().optional(),
  defaultCurrencyId: bigintIdSchema.optional().nullable(),
  status: companyStatusSchema.optional(),
});

export const UpdateCompanyStatusSchema = z.object({
  status: companyStatusSchema,
});

export class CreateCompanyDto extends createZodDto(CreateCompanySchema) {}
export class UpdateCompanyDto extends createZodDto(UpdateCompanySchema) {}
export class UpdateCompanyStatusDto extends createZodDto(UpdateCompanyStatusSchema) {}
