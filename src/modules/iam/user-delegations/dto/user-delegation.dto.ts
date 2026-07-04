import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

export const delegationStatusSchema = z.enum(['active', 'expired', 'cancelled']);

export const CreateUserDelegationSchema = z.object({
  delegateUserId: bigintIdSchema,
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
  reason: z.string().max(255).optional(),
  status: delegationStatusSchema.optional().default('active'),
});

export const UpdateUserDelegationSchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional().nullable(),
  reason: z.string().max(255).optional().nullable(),
  status: delegationStatusSchema.optional(),
});

export class CreateUserDelegationDto extends createZodDto(CreateUserDelegationSchema) {}
export class UpdateUserDelegationDto extends createZodDto(UpdateUserDelegationSchema) {}
