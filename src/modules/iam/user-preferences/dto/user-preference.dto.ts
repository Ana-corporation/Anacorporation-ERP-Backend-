import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const themeSchema = z.enum(['light', 'dark', 'system']);

export const CreateUserPreferenceSchema = z.object({
  companyId: z.string().min(1).optional().nullable(),
  theme: themeSchema.optional().default('light'),
  accentColor: z.string().max(20).optional(),
  language: z.string().max(10).optional().default('en'),
  dashboardLayout: z.string().max(40).optional(),
  homePage: z.string().max(120).optional(),
  menuStyle: z.string().max(30).optional(),
  fontSize: z.string().max(20).optional(),
  density: z.string().max(20).optional(),
  dateFormat: z.string().max(30).optional().default('yyyy-MM-dd'),
  timeFormat: z.string().max(20).optional().default('HH:mm'),
  numberFormat: z.string().max(30).optional(),
  currencyFormat: z.string().max(30).optional(),
  defaultPrinter: z.string().max(120).optional(),
  defaultReportFormat: z.string().max(20).optional(),
  defaultWarehouseId: z.string().min(1).optional().nullable(),
  defaultBranchId: z.string().min(1).optional().nullable(),
  defaultFinancialYear: z.string().max(20).optional(),
  defaultScreen: z.string().max(120).optional(),
  notificationPreference: z.string().max(40).optional(),
});

export const UpdateUserPreferenceSchema = CreateUserPreferenceSchema.partial().omit({ companyId: true });

export class CreateUserPreferenceDto extends createZodDto(CreateUserPreferenceSchema) {}
export class UpdateUserPreferenceDto extends createZodDto(UpdateUserPreferenceSchema) {}
