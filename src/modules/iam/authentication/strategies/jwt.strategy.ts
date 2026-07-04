import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { AuthService } from '@/modules/iam/authentication/auth.service';
import { SuperAdminAuthService } from '@/modules/iam/super-admins/super-admins.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
    private readonly superAdminAuthService: SuperAdminAuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.role === 'super_admin') {
      const sessionValid = await this.superAdminAuthService.validateSession(payload.sessionId);
      if (!sessionValid) {
        throw new UnauthorizedException('Session expired or revoked');
      }

      const superAdmin = await this.superAdminAuthService.resolveUser(payload);
      if (!superAdmin) {
        throw new UnauthorizedException('Invalid super admin');
      }

      return superAdmin;
    }

    if (!payload.companyId) {
      throw new UnauthorizedException('Invalid token');
    }

    const sessionValid = await this.authService.validateSession(payload.sessionId);
    if (!sessionValid) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    const userContext = await this.authService.getUserContext(
      payload.sub,
      payload.companyId,
      payload.sessionId,
    );

    if (!userContext) {
      throw new UnauthorizedException('Invalid user or company membership');
    }

    return userContext;
  }
}
