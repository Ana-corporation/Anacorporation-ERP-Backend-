import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { optionalPhoneE164Schema } from '@/common/utils/phone.util';
import { optionalNullableBigintIdSchema } from '@/common/zod/common.schemas';

/** Match prisma/crm/customers.prisma column sizes. */
const emptyToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

const optionalTrimmed = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const CUSTOMER_TYPES = ['BUSINESS', 'INDIVIDUAL'] as const;
/** Generic registration types; new countries extend this list without a DB migration. */
export const TAX_IDENTIFIER_TYPES = ['GSTIN', 'PAN', 'VAT', 'EIN', 'ABN', 'TRN', 'OTHER'] as const;
export type TaxIdentifierType = (typeof TAX_IDENTIFIER_TYPES)[number];

export const CustomerTaxIdentifierInputSchema = z.object({
  idType: z.enum(TAX_IDENTIFIER_TYPES),
  /** Shown on PDFs when idType is OTHER */
  idLabel: optionalTrimmed(60),
  idValue: z.string().trim().min(1).max(60),
  /** ISO 3166-2 region part when region-bound (GSTIN state) */
  regionCode: optionalTrimmed(10),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const CustomerAddressInputSchema = z.object({
  addressType: z.enum(['BILL_TO', 'SHIP_TO']).optional().default('BILL_TO'),
  label: optionalTrimmed(60),
  line1: z.string().trim().min(1).max(255),
  line2: optionalTrimmed(255),
  city: optionalTrimmed(100),
  region: optionalTrimmed(100),
  regionCode: optionalTrimmed(10),
  postalCode: optionalTrimmed(20),
  /** ISO 3166-1 alpha-2 */
  countryCode: z.preprocess(emptyToUndefined, z.string().trim().length(2).toUpperCase().optional()),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const CustomerContactInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  designation: optionalTrimmed(100),
  email: z.preprocess(emptyToUndefined, z.string().trim().email().max(255).optional()),
  phone: optionalPhoneE164Schema,
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const CreateCustomerSchema = z.object({
  /** Omitted = auto-generated from the CUSTOMER number series (CUS00001). */
  customerCode: optionalTrimmed(40),
  name: z.string().trim().min(1).max(200),
  legalName: optionalTrimmed(255),
  customerType: z.enum(CUSTOMER_TYPES).optional().default('BUSINESS'),
  email: z.preprocess(emptyToUndefined, z.string().trim().email().max(255).optional()),
  phone: optionalPhoneE164Schema,
  website: optionalTrimmed(255),
  /** Omitted = company default currency */
  currencyId: optionalNullableBigintIdSchema,
  paymentTermId: optionalNullableBigintIdSchema,
  creditLimit: z.preprocess(emptyToUndefined, z.coerce.number().nonnegative().optional()),
  salespersonUserId: optionalNullableBigintIdSchema,
  notes: optionalTrimmed(1000),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  taxIdentifiers: z.array(CustomerTaxIdentifierInputSchema).max(20).optional().default([]),
  addresses: z.array(CustomerAddressInputSchema).max(50).optional().default([]),
  contacts: z.array(CustomerContactInputSchema).max(50).optional().default([]),
});

/** customerCode is immutable. Child arrays, when sent, replace the stored set. */
export const UpdateCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  legalName: optionalTrimmed(255),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  email: z.preprocess(emptyToUndefined, z.string().trim().email().max(255).optional()),
  phone: optionalPhoneE164Schema,
  website: optionalTrimmed(255),
  currencyId: optionalNullableBigintIdSchema,
  paymentTermId: optionalNullableBigintIdSchema,
  creditLimit: z.preprocess(emptyToUndefined, z.coerce.number().nonnegative().optional()),
  salespersonUserId: optionalNullableBigintIdSchema,
  notes: optionalTrimmed(1000),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  taxIdentifiers: z.array(CustomerTaxIdentifierInputSchema).max(20).optional(),
  addresses: z.array(CustomerAddressInputSchema).max(50).optional(),
  contacts: z.array(CustomerContactInputSchema).max(50).optional(),
  /** Optimistic concurrency: when sent and stale → 409 CUSTOMER_CONFLICT */
  rowVersion: z.coerce.number().int().optional(),
});

export const CustomerLookupQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const RegistrationLookupQuerySchema = z.object({
  idType: z.enum(TAX_IDENTIFIER_TYPES),
  idValue: z.string().trim().min(1).max(60),
});

export class CreateCustomerDto extends createZodDto(CreateCustomerSchema) {}
export class UpdateCustomerDto extends createZodDto(UpdateCustomerSchema) {}
export class CustomerLookupQueryDto extends createZodDto(CustomerLookupQuerySchema) {}
export class RegistrationLookupQueryDto extends createZodDto(RegistrationLookupQuerySchema) {}

export type CustomerTaxIdentifierInput = z.infer<typeof CustomerTaxIdentifierInputSchema>;
export type CustomerAddressInput = z.infer<typeof CustomerAddressInputSchema>;
export type CustomerContactInput = z.infer<typeof CustomerContactInputSchema>;
