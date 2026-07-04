import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SuperAdminsController } from './super-admins.controller';
import { SuperAdminsRepository } from './super-admins.repository';
import { SuperAdminAuthService, SuperAdminsService } from './super-admins.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiration') || '15m',
        } as Record<string, unknown>,
      }),
    }),
  ],
  controllers: [SuperAdminsController],
  providers: [SuperAdminsRepository, SuperAdminsService, SuperAdminAuthService],
  exports: [SuperAdminsRepository, SuperAdminAuthService],
})
export class SuperAdminsModule {}
