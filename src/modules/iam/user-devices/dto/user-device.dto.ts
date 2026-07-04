import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateUserDeviceSchema = z.object({
  deviceUuid: z.string().min(1).max(100),
  deviceName: z.string().max(150).optional(),
  manufacturer: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  os: z.string().max(80).optional(),
  browser: z.string().max(80).optional(),
  lastSeen: z.string().datetime().optional(),
  isTrusted: z.boolean().optional().default(false),
  isBlocked: z.boolean().optional().default(false),
});

export const UpdateUserDeviceSchema = z.object({
  deviceName: z.string().max(150).optional().nullable(),
  manufacturer: z.string().max(100).optional().nullable(),
  model: z.string().max(100).optional().nullable(),
  os: z.string().max(80).optional().nullable(),
  browser: z.string().max(80).optional().nullable(),
  lastSeen: z.string().datetime().optional().nullable(),
  isTrusted: z.boolean().optional(),
  isBlocked: z.boolean().optional(),
});

export class CreateUserDeviceDto extends createZodDto(CreateUserDeviceSchema) {}
export class UpdateUserDeviceDto extends createZodDto(UpdateUserDeviceSchema) {}
