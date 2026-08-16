import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import * as cookieParser from 'cookie-parser';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { SimpleLogger } from './common/logger/simple.logger';
import { requestLogger } from './common/logger/request-logger.middleware';

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  loadEnvFile();

  const app = await NestFactory.create(AppModule, {
    logger: new SimpleLogger(),
  });

  app.use(cookieParser());
  app.use(requestLogger);

  const configService = app.get(ConfigService);
  const port = Number(process.env.PORT) || configService.get<number>('app.port') || 3002;
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api/v1';

  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'api/v1/health', method: RequestMethod.GET },
    ],
  });
  const corsOrigin = configService.get<string[]>('app.corsOrigin') ?? [
    'http://localhost:3001',
  ];
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  logger.log(`CORS origins → ${corsOrigin.join(', ')}`);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Manufacturing ERP API')
    .setDescription('Multi-tenant SaaS Manufacturing ERP Backend')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth')
    .addTag('Organizations')
    .addTag('Departments')
    .addTag('Designations')
    .addTag('Branches')
    .addTag('Warehouses')
    .addTag('Company Security Policies')
    .addTag('Company Subscriptions')
    .addTag('Company Modules')
    .addTag('Subscription Plans')
    .addTag('ERP Modules')
    .addTag('User API Keys')
    .addTag('User Attachments')
    .addTag('User Consents')
    .addTag('User Delegations')
    .addTag('User Devices')
    .addTag('User MFA')
    .addTag('User Module Access')
    .addTag('User Preferences')
    .addTag('User Sessions')
    .addTag('User Login History')
    .addTag('User Notifications')
    .addTag('User Signatures')
    .addTag('User Audit Logs')
    .addTag('Users')
    .addTag('Roles')
    .addTag('Customers')
    .addTag('Vendors')
    .addTag('Products')
    .addTag('Inventory')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document));

  app.enableShutdownHooks();

  // Cloud Run sets PORT=8080 and rejects a localhost-only bind.
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on ${port}`);
  logger.log(`Server running  → http://0.0.0.0:${port}/${apiPrefix}`);
  logger.log(`Swagger docs    → http://0.0.0.0:${port}/docs`);
}

bootstrap();
