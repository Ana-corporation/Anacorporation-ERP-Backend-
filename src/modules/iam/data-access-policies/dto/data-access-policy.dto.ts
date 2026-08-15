import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

const idListSchema = z.array(bigintIdSchema).default([]);

export const CreateDataAccessPolicySchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  description: z.string().optional(),
  isActive: z.boolean().optional().default(true),
  branchIds: idListSchema,
  departmentIds: idListSchema,
  warehouseIds: idListSchema,
});

export const UpdateDataAccessPolicySchema = z.object({
  code: z.string().trim().min(1).max(60).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  branchIds: z.array(bigintIdSchema).optional(),
  departmentIds: z.array(bigintIdSchema).optional(),
  warehouseIds: z.array(bigintIdSchema).optional(),
});

/** Spec V1: assign one policy to a user */
export const AssignUserDataAccessPolicySchema = z.object({
  policyId: bigintIdSchema,
});

/** Legacy FE replace-all (kept for drawer save until FE switches to POST/DELETE) */
export const SetUserDataAccessPoliciesSchema = z.object({
  policyIds: z.array(bigintIdSchema).default([]),
});

export class CreateDataAccessPolicyDto extends createZodDto(CreateDataAccessPolicySchema) {}
export class UpdateDataAccessPolicyDto extends createZodDto(UpdateDataAccessPolicySchema) {}
export class AssignUserDataAccessPolicyDto extends createZodDto(
  AssignUserDataAccessPolicySchema,
) {}
export class SetUserDataAccessPoliciesDto extends createZodDto(SetUserDataAccessPoliciesSchema) {}
