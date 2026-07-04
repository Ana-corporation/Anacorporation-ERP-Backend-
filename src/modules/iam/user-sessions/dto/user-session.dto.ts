import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const sessionStatusSchema = z.enum(['active', 'expired', 'revoked', 'logged_out']);

export const CreateUserSessionSchema = z.object({
  companyId: z.string().min(1).optional().nullable(),
  deviceId: z.string().min(1).optional().nullable(),
  loginTime: z.string().datetime().optional(),
  logoutTime: z.string().datetime().optional(),
  jwtToken: z.string().max(1000).optional(),
  refreshToken: z.string().max(500).optional(),
  browser: z.string().max(80).optional(),
  browserVersion: z.string().max(40).optional(),
  operatingSystem: z.string().max(80).optional(),
  deviceType: z.string().max(30).optional(),
  deviceName: z.string().max(150).optional(),
  ipAddress: z.string().optional(),
  country: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  sessionStatus: sessionStatusSchema.optional().default('active'),
});

export const UpdateUserSessionSchema = z.object({
  logoutTime: z.string().datetime().optional().nullable(),
  browser: z.string().max(80).optional().nullable(),
  browserVersion: z.string().max(40).optional().nullable(),
  operatingSystem: z.string().max(80).optional().nullable(),
  deviceType: z.string().max(30).optional().nullable(),
  deviceName: z.string().max(150).optional().nullable(),
  ipAddress: z.string().optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  sessionStatus: sessionStatusSchema.optional(),
});

export class CreateUserSessionDto extends createZodDto(CreateUserSessionSchema) {}
export class UpdateUserSessionDto extends createZodDto(UpdateUserSessionSchema) {}
