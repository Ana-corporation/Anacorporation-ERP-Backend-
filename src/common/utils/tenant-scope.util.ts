import { Prisma } from '@prisma/client';
import { parseBigIntId } from '@/common/utils/bigint.util';

/** Standard company_id filter for tenant-scoped Prisma queries. */
export function withCompanyScope(
  companyId: string,
  where: Record<string, unknown> = {},
  options?: { includeSoftDelete?: boolean },
): Record<string, unknown> {
  const scoped: Record<string, unknown> = {
    ...where,
    companyId: parseBigIntId(companyId),
  };

  if (options?.includeSoftDelete !== false && !('deletedAt' in where)) {
    scoped.deletedAt = null;
  }

  return scoped;
}

export function companyScopeWhere(
  companyId: string,
  extra?: Prisma.Enumerable<Record<string, unknown>>,
): { companyId: bigint; deletedAt: null } & Record<string, unknown> {
  return {
    ...(extra as Record<string, unknown>),
    companyId: parseBigIntId(companyId),
    deletedAt: null,
  };
}
