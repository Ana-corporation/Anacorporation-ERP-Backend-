import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdatePlatformCompanyStatusSchema = z.object({
  status: z.enum(['trial', 'active', 'suspended', 'cancelled']),
});

export class UpdatePlatformCompanyStatusDto extends createZodDto(UpdatePlatformCompanyStatusSchema) {}
