import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuditModule } from './infrastructure/audit/audit.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { ModulePermissionGuard } from './common/guards/module-permission.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { MustChangePasswordGuard } from './common/guards/must-change-password.guard';
import { SharedModule } from './modules/shared/shared.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { IamModule } from './modules/iam/iam.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { InventoryMasterModule } from './modules/inventory/inventory-master.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    StorageModule,
    // QueueModule (BullMQ) deferred until cloud — needs Redis and is unused locally.
    HealthModule,
    SharedModule,
    OrganizationModule,
    IamModule,
    SubscriptionModule,
    PurchaseModule,
    InventoryMasterModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ModulePermissionGuard },
  ],
})
export class AppModule {}
