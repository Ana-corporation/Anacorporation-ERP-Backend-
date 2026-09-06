import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

const optionalDateOrNull = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.string().date().nullable().optional(),
);

export const CreateModuleOverrideSchema = z.object({
  moduleId: bigintIdSchema,
  action: z.enum(['GRANT', 'REVOKE']),
  reason: z.string().trim().max(500).optional(),
  expiresAt: optionalDateOrNull,
});

export const UpdateModuleOverrideSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  expiresAt: optionalDateOrNull,
});

export const SetCompanyModuleEnabledSchema = z.object({
  enabled: z.boolean(),
});

export class CreateModuleOverrideDto extends createZodDto(CreateModuleOverrideSchema) {}
export class UpdateModuleOverrideDto extends createZodDto(UpdateModuleOverrideSchema) {}
export class SetCompanyModuleEnabledDto extends createZodDto(SetCompanyModuleEnabledSchema) {}

export const UpsertModuleAccessSchema = z.object({
  overrideType: z.enum(['GRANT', 'REVOKE']),
  reason: z.string().trim().max(500).optional(),
  effectiveUntil: optionalDateOrNull,
});

export class UpsertModuleAccessDto extends createZodDto(UpsertModuleAccessSchema) {}
