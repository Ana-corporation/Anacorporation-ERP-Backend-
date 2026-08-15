import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import * as cookieParser from 'cookie-parser';
import * as fs from 'fs';
import * as path from 'path';
import { SimpleLogger } from './common/logger/simple.logger';
import { requestLogger } from './common/logger/request-logger.middleware';
import {
  getRedisConnectionOptionsFromEnv,
  probeRedisAvailability,
} from './infrastructure/redis/redis.utils';

/** Load .env before AppModule so Redis probe sees REDIS_* / USE_MEMORY_SESSION. */
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

async function ensureRedisOrFallback(logger: Logger) {
  if (process.env.USE_MEMORY_SESSION === 'true') {
    return;
  }

  const reachable = await probeRedisAvailability(getRedisConnectionOptionsFromEnv());

  if (reachable) {
    logger.log('Redis reachable — auth sessions will use Redis');
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Redis is required in production but is not reachable. Start Redis before booting the app.',
    );
  }

  process.env.USE_MEMORY_SESSION = 'true';
  logger.warn(
    'Redis unavailable — using in-memory auth sessions (dev). Start Docker Redis when you want shared sessions.',
  );
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  loadEnvFile();
  await ensureRedisOrFallback(logger);

  // Dynamic import after Redis probe so Config/redis.useMemory matches fallback.
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.create(AppModule, {
    logger: new SimpleLogger(),
  });

  app.use(cookieParser());
  app.use(requestLogger);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api/v1';

  app.setGlobalPrefix(apiPrefix);
  const corsOrigin = configService.get<string>('app.corsOrigin') ?? 'http://localhost:3001';
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

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

  await app.listen(port);
  logger.log(`Server running  → http://localhost:${port}/${apiPrefix}`);
  logger.log(`Swagger docs    → http://localhost:${port}/docs`);
}

bootstrap();
