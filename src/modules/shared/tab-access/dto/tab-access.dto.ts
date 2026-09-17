import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const UpdateTabAccessSchema = z.object({
  roleIds: z.array(z.string().trim().min(1)).default([]),
});

export class UpdateTabAccessDto extends createZodDto(UpdateTabAccessSchema) {}
