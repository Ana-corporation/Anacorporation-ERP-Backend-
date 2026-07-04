import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const AddPlanModuleSchema = z.object({
  moduleId: bigintIdSchema,
});

export class AddPlanModuleDto extends createZodDto(AddPlanModuleSchema) {}
