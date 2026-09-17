import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { resolveDatabaseEnv, logDatabaseTarget } from './config/resolve-database-env';
import { SimpleLogger } from './common/logger/simple.logger';
import { requestLogger } from './common/logger/request-logger.middleware';
import { PrismaService } from './infrastructure/prisma/prisma.service';

function isCloudRun() {
  return Boolean(process.env.K_SERVICE);
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Startup-only: pick DEV or PROD database before Nest / Prisma construct clients.
  resolveDatabaseEnv();
  logDatabaseTarget((msg) => logger.log(msg));

  const port = Number(process.env.PORT) || 3002;

  logger.log('Creating Nest application');
  const createStarted = Date.now();
  const app = await NestFactory.create(AppModule, {
    logger: new SimpleLogger(),
  });
  logger.log(`Nest application created (${Date.now() - createStarted}ms)`);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cookieParserMod = require('cookie-parser') as { default?: () => unknown } & (() => unknown);
  const cookieParser = cookieParserMod.default ?? cookieParserMod;
  app.use(cookieParser());
  app.use(requestLogger);

  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api/v1';

  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/database', method: RequestMethod.GET },
      { path: 'api/v1/health', method: RequestMethod.GET },
      { path: 'api/v1/health/database', method: RequestMethod.GET },
      { path: 'docs', method: RequestMethod.GET },
      { path: 'docs-json', method: RequestMethod.GET },
      { path: 'docs-yaml', method: RequestMethod.GET },
      { path: 'favicon.ico', method: RequestMethod.GET },
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

  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Manufacturing ERP API')
    .setDescription('Multi-tenant SaaS Manufacturing ERP Backend')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Health')
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

  try {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), {
      useGlobalPrefix: false,
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger docs    → http://0.0.0.0:${port}/docs`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Swagger setup failed: ${message}`);
  }

  if (!isCloudRun()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { freePort } = require('../scripts/free-port.js') as {
        freePort: (port?: number | string) => { port: string; killed: number };
      };
      freePort(port);
    } catch (err) {
      logger.warn(`Could not free port ${port} before listen: ${(err as Error).message}`);
    }
  }

  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on ${port}`);
  logger.log(`Server running  → http://0.0.0.0:${port}/${apiPrefix}`);

  if (!isCloudRun()) {
    try {
      const prisma = app.get(PrismaService);
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      logger.log(`Database connected (${Date.now() - dbStart}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Database disconnected: ${message}`);
    }
  }
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Fatal bootstrap error: ${message}`);
  if (!isCloudRun()) {
    process.exit(1);
  }
});
