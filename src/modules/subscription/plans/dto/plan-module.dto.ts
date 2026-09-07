import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const AddPlanModuleSchema = z.object({
  moduleId: bigintIdSchema,
});

export const ReplacePlanModulesSchema = z.object({
  moduleCodes: z.array(z.string().trim().min(1)).default([]),
});

export class AddPlanModuleDto extends createZodDto(AddPlanModuleSchema) {}
export class ReplacePlanModulesDto extends createZodDto(ReplacePlanModulesSchema) {}
