import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { optionalOrgCodeSchema } from '@/common/zod/org-code.schema';

export const CreateBranchSchema = z.object({
  branchCode: optionalOrgCodeSchema,
  name: z.string().min(1).max(150),
  address: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  isActive: z.boolean().optional().default(true),
});

export const UpdateBranchSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  isActive: z.boolean().optional(),
});

export class CreateBranchDto extends createZodDto(CreateBranchSchema) {}
export class UpdateBranchDto extends createZodDto(UpdateBranchSchema) {}
