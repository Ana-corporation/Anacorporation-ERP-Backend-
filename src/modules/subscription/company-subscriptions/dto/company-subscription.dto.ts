import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';
import { billingCycleSchema } from '../../plans/dto/plan.dto';

export const subscriptionStatusSchema = z.enum(['active', 'expired', 'cancelled', 'trial', 'pending']);

export const CreateCompanySubscriptionSchema = z.object({
  planId: bigintIdSchema,
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
  billingCycle: billingCycleSchema.optional().default('monthly'),
  amount: z.coerce.number().min(0).optional().default(0),
  autoRenew: z.boolean().optional().default(true),
  status: subscriptionStatusSchema.optional().default('pending'),
});

export const UpdateCompanySubscriptionSchema = z.object({
  planId: bigintIdSchema.optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional().nullable(),
  billingCycle: billingCycleSchema.optional(),
  amount: z.coerce.number().min(0).optional(),
  autoRenew: z.boolean().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  status: subscriptionStatusSchema.optional(),
});

export class CreateCompanySubscriptionDto extends createZodDto(CreateCompanySubscriptionSchema) {}
export class UpdateCompanySubscriptionDto extends createZodDto(UpdateCompanySubscriptionSchema) {}

export const PatchCurrentSubscriptionSchema = z.object({
  autoRenew: z.boolean().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  planId: bigintIdSchema.optional(),
  status: subscriptionStatusSchema.optional(),
});

export class PatchCurrentSubscriptionDto extends createZodDto(PatchCurrentSubscriptionSchema) {}
