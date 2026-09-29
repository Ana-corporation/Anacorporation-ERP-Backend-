import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import {
  VENDOR_FORM_DEFAULT_MAX_SEND_COUNT,
  VENDOR_FORM_MAX_SEND_COUNT_LIMIT,
} from '../vendor-form.constants';

export const GenerateVendorEmailSchema = z.object({
  toEmail: z.string().trim().email().max(255),
  maxSendCount: z
    .number()
    .int()
    .min(1)
    .max(VENDOR_FORM_MAX_SEND_COUNT_LIMIT)
    .optional()
    .default(VENDOR_FORM_DEFAULT_MAX_SEND_COUNT),
});

export const SubmitVendorFormSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
});

export const VerifyVendorFormGstinSchema = z.object({
  gstin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().min(15).max(15)),
});

export class GenerateVendorEmailDto extends createZodDto(GenerateVendorEmailSchema) {}
export class SubmitVendorFormDto extends createZodDto(SubmitVendorFormSchema) {}
export class VerifyVendorFormGstinDto extends createZodDto(VerifyVendorFormGstinSchema) {}
