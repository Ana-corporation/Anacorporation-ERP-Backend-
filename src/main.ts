import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { SimpleLogger } from './common/logger/simple.logger';
import { requestLogger } from './common/logger/request-logger.middleware';
import {
  getRedisConnectionOptionsFromEnv,
  probeRedisAvailability,
} from './infrastructure/redis/redis.utils';

async function ensureRedisOrFallback(logger: Logger) {
  if (process.env.USE_MEMORY_SESSION === 'true') {
    return;
  }

  const reachable = await probeRedisAvailability(getRedisConnectionOptionsFromEnv());

  if (reachable) {
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Redis is required in production but is not reachable. Start Redis before booting the app.',
    );
  }

  process.env.USE_MEMORY_SESSION = 'true';
  logger.warn(
    'Redis unavailable — using in-memory sessions. BullMQ job queues are disabled until Redis is running.',
  );
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  await ensureRedisOrFallback(logger);
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
