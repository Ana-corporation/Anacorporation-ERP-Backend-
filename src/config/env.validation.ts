import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).default(3000),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(1),
    JWT_ACCESS_EXPIRATION: z.string().optional(),
    JWT_REFRESH_EXPIRATION: z.string().optional(),
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.coerce.number().int().optional(),
    REDIS_PASSWORD: z.string().optional(),
    GCS_PROJECT_ID: z.string().optional(),
    GCS_BUCKET: z.string().optional(),
    GCS_KEY_FILE_PATH: z.string().optional(),
    USE_MEMORY_SESSION: z.string().optional(),
    SESSION_IDLE_FLOOR_MIN: z.coerce.number().int().positive().optional(),
    TEMP_PASSWORD_TTL_HOURS: z.coerce.number().int().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.TEMP_PASSWORD_TTL_HOURS !== undefined && data.TEMP_PASSWORD_TTL_HOURS < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TEMP_PASSWORD_TTL_HOURS must be >= 1 (or omit for default 24)',
        path: ['TEMP_PASSWORD_TTL_HOURS'],
      });
    }
    if (data.NODE_ENV === 'production') {      if (
        data.JWT_SECRET.length < 32 ||
        data.JWT_SECRET.includes('change-me') ||
        data.JWT_SECRET.includes('dev-jwt')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JWT_SECRET must be a strong random string (32+ chars) in production',
        });
      }
      if (data.USE_MEMORY_SESSION === 'true') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'USE_MEMORY_SESSION must be false in production — start Redis',
        });
      }
    }
  });

export function validate(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(result.error.toString());
  }
  return result.data;
}
