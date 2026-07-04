import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema, companyStatusSchema } from '@/common/zod/common.schemas';

export const CreateCompanySchema = z.object({
  companyCode: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  legalName: z.string().optional(),
  domain: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  timezone: z.string().optional(),
  defaultCurrencyId: bigintIdSchema.optional(),
});

export const UpdateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional(),
  domain: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  timezone: z.string().optional(),
  defaultCurrencyId: bigintIdSchema.optional(),
  status: companyStatusSchema.optional(),
});

export class CreateCompanyDto extends createZodDto(CreateCompanySchema) {}
export class UpdateCompanyDto extends createZodDto(UpdateCompanySchema) {}
