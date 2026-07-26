import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ListQuerySchema } from '@/common/dto/pagination.dto';

export const VendorListQuerySchema = ListQuerySchema.extend({
  includeCustomFields: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional()
    .default(false),
}).passthrough();

export class VendorListQueryDto extends createZodDto(VendorListQuerySchema) {}

/** Extract cf.* query params: ?cf.vendorTier=preferred */
export function extractCfFilters(query: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('cf.')) continue;
    const fieldName = key.slice(3);
    if (!fieldName || value === undefined || value === null || value === '') continue;
    out[fieldName] = String(value);
  }
  return out;
}
