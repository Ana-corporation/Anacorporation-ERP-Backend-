import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import {
  optionalNullablePhoneE164Schema,
  optionalPhoneE164Schema,
} from '@/common/utils/phone.util';

export const CreateCustomerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: optionalPhoneE164Schema,
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  taxId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: optionalNullablePhoneE164Schema,
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  taxId: z.string().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export class CreateCustomerDto extends createZodDto(CreateCustomerSchema) {}
export class UpdateCustomerDto extends createZodDto(UpdateCustomerSchema) {}
