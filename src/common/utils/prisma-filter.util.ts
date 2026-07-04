import { ListQueryDto } from '@/common/dto/pagination.dto';

export interface ListFilterOptions {
  /** query param key -> prisma field (contains, case-insensitive) */
  contains?: Record<string, string>;
  /** query param key -> prisma field (exact match) */
  exact?: Record<string, string>;
  /** query param key -> prisma field (boolean) */
  booleans?: Record<string, string>;
  /** apply fromDate/toDate query params to this prisma date field */
  dateRange?: { field: string };
  /** free-text search across these prisma fields (OR) */
  searchFields?: string[];
  /** allowlisted sortBy fields */
  sortFields: string[];
  defaultSortField?: string;
}

function queryValue(query: ListQueryDto, key: string): unknown {
  return (query as unknown as Record<string, unknown>)[key];
}

export function buildListWhere(
  baseWhere: Record<string, unknown>,
  query: ListQueryDto,
  options: ListFilterOptions,
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  for (const [queryKey, prismaField] of Object.entries(options.contains ?? {})) {
    const val = queryValue(query, queryKey);
    if (typeof val === 'string' && val.trim().length > 0) {
      and.push({ [prismaField]: { contains: val.trim(), mode: 'insensitive' } });
    }
  }

  for (const [queryKey, prismaField] of Object.entries(options.exact ?? {})) {
    const val = queryValue(query, queryKey);
    if (val !== undefined && val !== null && val !== '') {
      and.push({ [prismaField]: val });
    }
  }

  for (const [queryKey, prismaField] of Object.entries(options.booleans ?? {})) {
    const val = queryValue(query, queryKey);
    if (typeof val === 'boolean') {
      and.push({ [prismaField]: val });
    }
  }

  if (options.dateRange && (query.fromDate || query.toDate)) {
    const range: Record<string, Date> = {};
    if (query.fromDate) range.gte = new Date(query.fromDate);
    if (query.toDate) range.lte = new Date(query.toDate);
    and.push({ [options.dateRange.field]: range });
  }

  if (query.search?.trim() && options.searchFields?.length) {
    and.push({
      OR: options.searchFields.map((field) => ({
        [field]: { contains: query.search!.trim(), mode: 'insensitive' },
      })),
    });
  }

  if (and.length === 0) return baseWhere;
  return { ...baseWhere, AND: and };
}

export function resolveOrderBy(query: ListQueryDto, options: ListFilterOptions) {
  const defaultField = options.defaultSortField ?? options.sortFields[0] ?? 'createdAt';
  const sortBy = query.sortBy && options.sortFields.includes(query.sortBy) ? query.sortBy : defaultField;
  return { [sortBy]: query.sortOrder ?? 'desc' };
}
