import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const billingCycleSchema = z.enum(['monthly', 'yearly', 'quarterly']);

export const CreateSubscriptionPlanSchema = z.object({
  planCode: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  price: z.coerce.number().min(0).optional().default(0),
  billingCycle: billingCycleSchema.optional().default('monthly'),
  maxUsers: z.coerce.number().int().positive().optional(),
  maxStorageGb: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().optional().default(true),
});

export const UpdateSubscriptionPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  price: z.coerce.number().min(0).optional(),
  billingCycle: billingCycleSchema.optional(),
  maxUsers: z.coerce.number().int().positive().optional().nullable(),
  maxStorageGb: z.coerce.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
});

export class CreateSubscriptionPlanDto extends createZodDto(CreateSubscriptionPlanSchema) {}
export class UpdateSubscriptionPlanDto extends createZodDto(UpdateSubscriptionPlanSchema) {}
