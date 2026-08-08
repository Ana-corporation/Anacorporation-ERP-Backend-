import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { SUPPLIER_TYPES } from '../vendor-code.util';

/** Match prisma/purchase/vendors.prisma column sizes. */
const emptyToUndefined = (value: unknown) =>
  value === '' || value === null ? undefined : value;

const optionalTrimmed = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max).optional(),
  );

export const CreateVendorSchema = z.object({
  /**
   * Required on create — saved on Vendor and used to auto-generate vendorCode
   * (RM001 / CS001 / SP001 / ES001). Exact Ana Excel labels.
   * Immutable after create (tied to vendorCode prefix).
   */
  supplierType: z.enum(SUPPLIER_TYPES),
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
  /** Company-defined custom fields (UDF) — validated against definitions. */
  customFields: z.record(z.string(), z.unknown()).optional(),
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
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export class CreateVendorDto extends createZodDto(CreateVendorSchema) {}
export class UpdateVendorDto extends createZodDto(UpdateVendorSchema) {}
