import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const CreateCompanyModuleSchema = z.object({
  moduleId: bigintIdSchema,
  isActive: z.boolean().optional().default(true),
  activatedDate: z.string().date().optional(),
  expiryDate: z.string().date().optional(),
});

export const UpdateCompanyModuleSchema = z.object({
  isActive: z.boolean().optional(),
  activatedDate: z.string().date().optional(),
  expiryDate: z.string().date().optional().nullable(),
});

export class CreateCompanyModuleDto extends createZodDto(CreateCompanyModuleSchema) {}
export class UpdateCompanyModuleDto extends createZodDto(UpdateCompanyModuleSchema) {}
