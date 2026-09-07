import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { SuperAdminsModule } from '@/modules/iam/super-admins/super-admins.module';
import { EntitlementsModule } from '@/modules/subscription/entitlements/entitlements.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { CompanyAccessContextRepository } from './company-access-context.repository';
import { CompanyAccessContextService } from './company-access-context.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthSessionModule } from './auth-session.module';
import { CompanySecurityPolicyService } from './company-security-policy.service';
import { UserContextCacheService } from './user-context-cache.service';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { RoleLoginResponseBuilder } from './role-access/role-login-response.builder';

@Module({
  imports: [
    AuthSessionModule,
    SuperAdminsModule,
    forwardRef(() => EntitlementsModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiration') || '8h',
        } as Record<string, unknown>,
      }),
    }),
  ],
  controllers: [AuthController, OAuthController],
  providers: [
    AuthRepository,
    CompanyAccessContextRepository,
    CompanyAccessContextService,
    CompanySecurityPolicyService,
    UserContextCacheService,
    RoleLoginResponseBuilder,
    AuthService,
    OAuthService,
    JwtStrategy,
    // JwtStrategy,
  ],
  exports: [
    AuthService,
    AuthSessionModule,
    CompanyAccessContextService,
    UserContextCacheService,
    JwtModule,
  ],
})
export class AuthModule {}
