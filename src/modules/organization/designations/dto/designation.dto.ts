import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateDesignationSchema = z.object({
  designationCode: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  gradeLevel: z.coerce.number().int().min(1).max(99).optional(),
  isActive: z.boolean().optional().default(true),
});

export const UpdateDesignationSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  gradeLevel: z.coerce.number().int().min(1).max(99).optional().nullable(),
  isActive: z.boolean().optional(),
});

export class CreateDesignationDto extends createZodDto(CreateDesignationSchema) {}
export class UpdateDesignationDto extends createZodDto(UpdateDesignationSchema) {}
