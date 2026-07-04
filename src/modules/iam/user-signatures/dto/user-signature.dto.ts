import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const signatureTypeSchema = z.enum([
  'invoice',
  'purchase',
  'approval',
  'digital_certificate',
  'rubber_stamp',
]);

export const CreateUserSignatureSchema = z.object({
  companyId: z.string().min(1).optional().nullable(),
  signatureType: signatureTypeSchema,
  imagePath: z.string().max(500).optional(),
  certificateData: z.string().optional(),
  isDefault: z.boolean().optional().default(false),
  validFrom: z.string().date().optional(),
  validTo: z.string().date().optional(),
});

export const UpdateUserSignatureSchema = z.object({
  imagePath: z.string().max(500).optional().nullable(),
  certificateData: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  validFrom: z.string().date().optional().nullable(),
  validTo: z.string().date().optional().nullable(),
});

export class CreateUserSignatureDto extends createZodDto(CreateUserSignatureSchema) {}
export class UpdateUserSignatureDto extends createZodDto(UpdateUserSignatureSchema) {}
