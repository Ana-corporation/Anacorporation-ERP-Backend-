import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const FormConfigurationFieldUpdateSchema = z
  .object({
    fieldKey: z.string().trim().min(1).max(80),
    isVisible: z.boolean().optional(),
    isRegistrationVisible: z.boolean().optional(),
    /** Mandatory override (configurable fields only). */
    isRequired: z.boolean().optional(),
    /** Company label; null or '' = back to the default label. */
    label: z.string().trim().max(100).nullable().optional(),
  })
  .refine(
    (row) =>
      row.isVisible !== undefined ||
      row.isRegistrationVisible !== undefined ||
      row.isRequired !== undefined ||
      row.label !== undefined,
    {
      message: 'Provide isVisible, isRegistrationVisible, isRequired and/or label',
      path: ['isVisible'],
    },
  );

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
