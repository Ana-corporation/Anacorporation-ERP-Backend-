import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateVendorSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  taxId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateVendorSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  taxId: z.string().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export class CreateVendorDto extends createZodDto(CreateVendorSchema) {}
export class UpdateVendorDto extends createZodDto(UpdateVendorSchema) {}
