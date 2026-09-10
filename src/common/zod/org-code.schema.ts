import { z } from 'zod';

/** Empty / null code → undefined so BE can auto-generate. Max 30 (org VarChar). */
export const optionalOrgCodeSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}, z.string().trim().min(1).max(30).optional());
