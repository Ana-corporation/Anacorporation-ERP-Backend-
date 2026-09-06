import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const ConfirmImportSchema = z.object({
  importId: bigintIdSchema,
});

export class ConfirmImportDto extends createZodDto(ConfirmImportSchema) {}
