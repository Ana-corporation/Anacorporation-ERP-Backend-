import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateUserNotificationSchema = z.object({
  emailEnabled: z.boolean().optional().default(true),
  smsEnabled: z.boolean().optional().default(false),
  whatsappEnabled: z.boolean().optional().default(false),
  pushEnabled: z.boolean().optional().default(true),
  teamsEnabled: z.boolean().optional().default(false),
  slackEnabled: z.boolean().optional().default(false),
});

export const UpdateUserNotificationSchema = CreateUserNotificationSchema.partial();

export class CreateUserNotificationDto extends createZodDto(CreateUserNotificationSchema) {}
export class UpdateUserNotificationDto extends createZodDto(UpdateUserNotificationSchema) {}
