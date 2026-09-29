import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const FormConfigurationFieldUpdateSchema = z
  .object({
    fieldKey: z.string().trim().min(1).max(80),
    isVisible: z.boolean().optional(),
    isRegistrationVisible: z.boolean().optional(),
  })
  .refine((row) => row.isVisible !== undefined || row.isRegistrationVisible !== undefined, {
    message: 'Provide isVisible and/or isRegistrationVisible',
    path: ['isVisible'],
  });

export const UpdateFormConfigurationSchema = z.object({
  fields: z.array(FormConfigurationFieldUpdateSchema).min(1),
});

export class UpdateFormConfigurationDto extends createZodDto(UpdateFormConfigurationSchema) {}
