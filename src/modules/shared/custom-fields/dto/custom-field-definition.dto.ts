import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { CUSTOM_FIELD_ENTITY_TYPES, FIELD_NAME_REGEX } from '../custom-fields.constants';

const fieldOptionSchema = z.object({
  value: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  displayOrder: z.number().int().min(0).optional(),
});

const validationSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    regex: z.string().max(500).optional(),
    unique: z.boolean().optional(),
    allowDecimal: z.boolean().optional(),
  })
  .optional();

export const CreateCustomFieldDefinitionSchema = z.object({
  entityType: z.enum(CUSTOM_FIELD_ENTITY_TYPES),
  /** Optional — if omitted, backend generates from displayName. */
  fieldName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(FIELD_NAME_REGEX, 'fieldName must start with a letter and use letters, numbers, or underscore')
    .optional(),
  displayName: z.string().trim().min(1).max(120),
  fieldType: z.string().trim().min(1).max(40),
  /** Required — must be a known section from meta/sections. */
  sectionKey: z.string().trim().min(1).max(40),
  isRequired: z.boolean().optional().default(false),
  defaultValue: z.unknown().optional(),
  validation: validationSchema,
  options: z.array(fieldOptionSchema).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
  placeholder: z.string().trim().max(255).optional().nullable(),
  helpText: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional().default(true),
  isReadOnly: z.boolean().optional().default(false),
  isHidden: z.boolean().optional().default(false),
  isSearchable: z.boolean().optional().default(false),
  isFilterable: z.boolean().optional().default(false),
  isSortable: z.boolean().optional().default(false),
  isExportable: z.boolean().optional().default(true),
  isPrintable: z.boolean().optional().default(true),
});

export const UpdateCustomFieldDefinitionSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  fieldType: z.string().trim().min(1).max(40).optional(),
  sectionKey: z.string().trim().max(40).optional().nullable(),
  isRequired: z.boolean().optional(),
  defaultValue: z.unknown().optional().nullable(),
  validation: validationSchema.nullable(),
  options: z.array(fieldOptionSchema).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  placeholder: z.string().trim().max(255).optional().nullable(),
  helpText: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  isReadOnly: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  isFilterable: z.boolean().optional(),
  isSortable: z.boolean().optional(),
  isExportable: z.boolean().optional(),
  isPrintable: z.boolean().optional(),
});

export const CustomFieldDefinitionsQuerySchema = z.object({
  entityType: z.enum(CUSTOM_FIELD_ENTITY_TYPES).optional(),
  includeInactive: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional()
    .default(false),
  groupedBySection: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional()
    .default(false),
});

export class CreateCustomFieldDefinitionDto extends createZodDto(
  CreateCustomFieldDefinitionSchema,
) {}

export class UpdateCustomFieldDefinitionDto extends createZodDto(
  UpdateCustomFieldDefinitionSchema,
) {}

export class CustomFieldDefinitionsQueryDto extends createZodDto(
  CustomFieldDefinitionsQuerySchema,
) {}
