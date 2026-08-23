import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const FormConfigurationFieldUpdateSchema = z.object({
  fieldKey: z.string().trim().min(1).max(80),
  isVisible: z.boolean(),
});

export const UpdateFormConfigurationSchema = z.object({
  fields: z.array(FormConfigurationFieldUpdateSchema).min(1),
});

export class UpdateFormConfigurationDto extends createZodDto(UpdateFormConfigurationSchema) {}
