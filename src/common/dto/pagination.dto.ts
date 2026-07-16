import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema } from '@/common/zod/common.schemas';

/** Shared list/query filters — every GET list endpoint accepts these (repos use what applies). */
export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  // FE admin catalogues use limit=200 (companies / plans / modules / users)
  limit: z.coerce.number().int().min(1).max(200).optional().default(20),
  search: z.string().optional(),
  sortBy: z.string().optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  // common exact / contains filters
  isActive: z.coerce.boolean().optional(),
  status: z.string().optional(),
  code: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  // entity-specific optional filters (ignored when not used by repo)
  documentType: z.string().optional(),
  consentType: z.string().optional(),
  signatureType: z.string().optional(),
  mfaType: z.string().optional(),
  accessType: z.string().optional(),
  sessionStatus: z.string().optional(),
  loginResult: z.string().optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  manufacturer: z.string().optional(),
  deviceUuid: z.string().optional(),
  moduleId: bigintIdSchema.optional(),
  planId: bigintIdSchema.optional(),
  moduleType: z.enum(['product', 'admin']).optional(),
  isTrusted: z.coerce.boolean().optional(),
  isBlocked: z.coerce.boolean().optional(),
  isVerified: z.coerce.boolean().optional(),
  isAccepted: z.coerce.boolean().optional(),
  isPrimary: z.coerce.boolean().optional(),
  isEnabled: z.coerce.boolean().optional(),
  isDefault: z.coerce.boolean().optional(),
  action: z.string().optional(),
  entityName: z.string().optional(),
});

/** @deprecated alias — use ListQueryDto */
export const PaginationQuerySchema = ListQuerySchema;

export class ListQueryDto extends createZodDto(ListQuerySchema) {}
export class PaginationQueryDto extends ListQueryDto {}

export type ListQuery = z.infer<typeof ListQuerySchema>;
export type PaginationQuery = ListQuery;

export function getPaginationParams(dto: ListQuery) {
  const page = Math.max(1, Number(dto.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(dto.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}
