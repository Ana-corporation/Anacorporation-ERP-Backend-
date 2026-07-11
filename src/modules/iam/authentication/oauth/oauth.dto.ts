import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const OAuthStartSchema = z.object({
  companyCode: z.string().min(1),
  redirectUri: z.string().url(),
});

export const OAuthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const OAuthExchangeSchema = z.object({
  code: z.string().min(1),
  companyCode: z.string().min(1),
  redirectUri: z.string().url(),
});

export class OAuthStartDto extends createZodDto(OAuthStartSchema) {}
export class OAuthCallbackDto extends createZodDto(OAuthCallbackSchema) {}
export class OAuthExchangeDto extends createZodDto(OAuthExchangeSchema) {}
