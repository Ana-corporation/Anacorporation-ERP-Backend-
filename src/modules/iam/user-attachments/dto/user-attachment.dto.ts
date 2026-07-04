import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const documentTypeSchema = z.enum([
  'passport',
  'driving_license',
  'contract',
  'resume',
  'certificate',
  'nda',
  'other',
]);

export const CreateUserAttachmentSchema = z.object({
  documentType: documentTypeSchema,
  fileName: z.string().min(1).max(255).optional(),
  filePath: z.string().min(1).max(500),
  fileSize: z.coerce.number().int().nonnegative().optional(),
  mimeType: z.string().max(120).optional(),
  expiryDate: z.string().date().optional(),
});

export const UpdateUserAttachmentSchema = z.object({
  documentType: documentTypeSchema.optional(),
  fileName: z.string().min(1).max(255).optional().nullable(),
  filePath: z.string().min(1).max(500).optional(),
  fileSize: z.coerce.number().int().nonnegative().optional().nullable(),
  mimeType: z.string().max(120).optional().nullable(),
  expiryDate: z.string().date().optional().nullable(),
  isVerified: z.boolean().optional(),
});

export class CreateUserAttachmentDto extends createZodDto(CreateUserAttachmentSchema) {}
export class UpdateUserAttachmentDto extends createZodDto(UpdateUserAttachmentSchema) {}
