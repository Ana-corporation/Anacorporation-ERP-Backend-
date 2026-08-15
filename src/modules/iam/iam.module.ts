import { Module } from '@nestjs/common';
import { AuthModule } from './authentication/auth.module';
import { PlatformModule } from './platform/platform.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { SuperAdminsModule } from './super-admins/super-admins.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { UserAttachmentsModule } from './user-attachments/user-attachments.module';
import { UserAuditModule } from './user-audit/user-audit.module';
import { UserConsentsModule } from './user-consents/user-consents.module';
import { UserDelegationsModule } from './user-delegations/user-delegations.module';
import { UserDevicesModule } from './user-devices/user-devices.module';
import { UserLoginHistoryModule } from './user-login-history/user-login-history.module';
import { UserMfaModule } from './user-mfa/user-mfa.module';
import { UserModuleAccessModule } from './user-module-access/user-module-access.module';
import { PermissionSetsModule } from './permission-sets/permission-sets.module';
import { DataAccessPoliciesModule } from './data-access-policies/data-access-policies.module';
import { UserNotificationsModule } from './user-notifications/user-notifications.module';
import { UserPreferencesModule } from './user-preferences/user-preferences.module';
import { UserSessionsModule } from './user-sessions/user-sessions.module';
import { UserSignaturesModule } from './user-signatures/user-signatures.module';

@Module({
  imports: [
    AuthModule,
    PlatformModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    SuperAdminsModule,
    ApiKeysModule,
    UserAttachmentsModule,
    UserAuditModule,
    UserConsentsModule,
    UserDelegationsModule,
    UserDevicesModule,
    UserLoginHistoryModule,
    UserMfaModule,
    UserModuleAccessModule,
    PermissionSetsModule,
    DataAccessPoliciesModule,
    UserNotificationsModule,
    UserPreferencesModule,
    UserSessionsModule,
    UserSignaturesModule,
  ],
  exports: [
    AuthModule,
    PlatformModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    SuperAdminsModule,
    ApiKeysModule,
    UserAttachmentsModule,
    UserAuditModule,
    UserConsentsModule,
    UserDelegationsModule,
    UserDevicesModule,
    UserLoginHistoryModule,
    UserMfaModule,
    UserModuleAccessModule,
    PermissionSetsModule,
    DataAccessPoliciesModule,
    UserNotificationsModule,
    UserPreferencesModule,
    UserSessionsModule,
    UserSignaturesModule,
  ],
})
export class IamModule {}
