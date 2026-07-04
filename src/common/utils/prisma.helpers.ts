import { Prisma } from '@prisma/client';

export const softDeleteFilter = { deletedAt: null };

export function withTenant(
  organizationId: string,
  where: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...where, organizationId, deletedAt: null };
}

export function softDeleteData(): { deletedAt: Date } {
  return { deletedAt: new Date() };
}

export function buildSearchFilter(
  search: string | undefined,
  fields: string[],
): Prisma.StringFilter | undefined {
  if (!search?.trim()) return undefined;

  return {
    contains: search.trim(),
    mode: 'insensitive',
  };
}

export function buildOrSearch(
  search: string | undefined,
  fields: string[],
): { OR: Record<string, Prisma.StringFilter>[] } | undefined {
  if (!search?.trim()) return undefined;

  return {
    OR: fields.map((field) => ({
      [field]: { contains: search.trim(), mode: 'insensitive' as const },
    })),
  };
}
