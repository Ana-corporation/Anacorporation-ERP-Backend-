import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Match prisma/purchase/vendors.prisma column sizes. */
const emptyToUndefined = (value: unknown) =>
  value === '' || value === null ? undefined : value;

const optionalTrimmed = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max).optional(),
  );

export const CreateVendorSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  email: z.preprocess(
    emptyToUndefined,
    z.string().trim().email().max(255).optional(),
  ),
  phone: optionalTrimmed(50),
  address: optionalTrimmed(500),
  city: optionalTrimmed(100),
  country: optionalTrimmed(100),
  taxId: optionalTrimmed(80),
  isActive: z.boolean().optional(),
  /** Advanced SAP-style fields live here (payment, bank, accounting, remarks). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateVendorSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.preprocess(
    emptyToUndefined,
    z.string().trim().email().max(255).optional(),
  ),
  phone: optionalTrimmed(50),
  address: optionalTrimmed(500),
  city: optionalTrimmed(100),
  country: optionalTrimmed(100),
  taxId: optionalTrimmed(80),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class CreateVendorDto extends createZodDto(CreateVendorSchema) {}
export class UpdateVendorDto extends createZodDto(UpdateVendorSchema) {}
