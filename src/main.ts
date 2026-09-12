import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import * as cookieParser from 'cookie-parser';
import * as fs from 'fs';
import * as path from 'path';
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { AppModule } from './app.module';
import { applyGcpSqlDatabaseUrl } from './config/gcp-sql-url';
import { SimpleLogger } from './common/logger/simple.logger';
import { requestLogger } from './common/logger/request-logger.middleware';
import { PrismaService } from './infrastructure/prisma/prisma.service';

function isCloudRun() {
  return Boolean(process.env.K_SERVICE);
}

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
  applyGcpSqlDatabaseUrl();
}

function startingHandler(req: IncomingMessage, res: ServerResponse) {
  const pathName = (req.url || '/').split('?')[0];
  const live =
    pathName === '/health/live' || pathName === '/health' || pathName === '/api/v1/health';
  res.writeHead(live ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'starting',
      service: 'anacorporation-erp-backend',
      timestamp: new Date().toISOString(),
    }),
  );
}

function listenEarly(port: number): Promise<Server> {
  const server = createServer(startingHandler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  loadEnvFile();

  const port = Number(process.env.PORT) || 3002;
  const prebound = (global as typeof globalThis & { __ancEarlyServer?: Server }).__ancEarlyServer;
  const preboundHandler = (global as typeof globalThis & { __ancStartingHandler?: typeof startingHandler })
    .__ancStartingHandler;
  let earlyServer: Server | undefined = prebound;

  if (!earlyServer && isCloudRun()) {
    earlyServer = await listenEarly(port);
    logger.log(`API listening on ${port} (Cloud Run startup)`);
  }

  const app = await NestFactory.create(AppModule, {
    logger: new SimpleLogger(),
  });

  app.use(cookieParser());
  app.use(requestLogger);

  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api/v1';

  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
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

  app.enableShutdownHooks();

  if (earlyServer) {
    const expressApp = app.getHttpAdapter().getInstance();
    earlyServer.removeListener('request', preboundHandler ?? startingHandler);
    earlyServer.on('request', expressApp);
    logger.log(`Server running  → http://0.0.0.0:${port}/${apiPrefix}`);
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { freePort } = require('../scripts/free-port.js') as {
        freePort: (port?: number | string) => { port: string; killed: number };
      };
      freePort(port);
    } catch (err) {
      logger.warn(`Could not free port ${port} before listen: ${(err as Error).message}`);
    }
    await app.listen(port, '0.0.0.0');
    logger.log(`API listening on ${port}`);
    logger.log(`Server running  → http://0.0.0.0:${port}/${apiPrefix}`);
  }

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

  try {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document));
    logger.log(`Swagger docs    → http://0.0.0.0:${port}/docs`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Swagger setup failed: ${message}`);
  }

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

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Fatal bootstrap error: ${message}`);
  if (!isCloudRun()) {
    process.exit(1);
  }
});
