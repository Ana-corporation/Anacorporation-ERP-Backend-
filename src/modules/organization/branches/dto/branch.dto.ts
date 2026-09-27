import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { optionalOrgCodeSchema } from '@/common/zod/org-code.schema';
import {
  optionalNullablePhoneE164Schema,
  optionalPhoneE164Schema,
} from '@/common/utils/phone.util';

export const CreateBranchSchema = z.object({
  branchCode: optionalOrgCodeSchema,
  name: z.string().min(1).max(150),
  address: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  phone: optionalPhoneE164Schema,
  isActive: z.boolean().optional().default(true),
});

export const UpdateBranchSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  phone: optionalNullablePhoneE164Schema,
  isActive: z.boolean().optional(),
});

export class CreateBranchDto extends createZodDto(CreateBranchSchema) {}
export class UpdateBranchDto extends createZodDto(UpdateBranchSchema) {}
