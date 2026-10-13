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

export const UpdateFieldOrderSchema = z.object({
  sections: z
    .array(
      z.object({
        sectionKey: z.string().trim().min(1).max(40),
        fields: z
          .array(
            z.object({
              fieldKey: z.string().trim().min(1).max(80),
              source: z.enum(['BUILT_IN', 'CUSTOM']),
              displayOrder: z.number().int().min(1).max(9999),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export class UpdateFieldOrderDto extends createZodDto(UpdateFieldOrderSchema) {}
