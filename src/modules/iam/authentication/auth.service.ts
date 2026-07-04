import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { UserAuditAction } from '@prisma/client';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { AuthenticatedUser, JwtPayload } from '@/common/interfaces/auth.interface';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@/common/exceptions/business.exception';
import { DEFAULT_ADMIN_PERMISSIONS } from '@/common/constants/permissions.constant';
import { LoginDto, SignUpDto } from './dto/auth.dto';
import { AuthRepository } from './auth.repository';

interface SessionData {
  userId: string;
  companyId: string;
  refreshTokenHash: string;
}

@Injectable()
export class AuthService {
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly auditService: AuditService,
  ) {
    this.refreshTtlSeconds = 7 * 24 * 60 * 60;
  }

  async signUp(dto: SignUpDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Password and confirm password do not match');
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.authRepository.findUserByEmail(email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    await this.authRepository.ensurePermissionsSeeded();
    const permissions = await this.authRepository.getAllPermissions();
    const adminPermissionIds = permissions
      .filter((p) =>
        DEFAULT_ADMIN_PERMISSIONS.includes(
          p.permissionCode as (typeof DEFAULT_ADMIN_PERMISSIONS)[number],
        ),
      )
      .map((p) => p.permissionId);

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const result = await this.authRepository.createSignupTransaction({
      email,
      passwordHash,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      companyName: dto.companyName.trim(),
      permissionIds: adminPermissionIds,
    });

    await this.auditService.log({
      companyId: result.company.id,
      userId: result.user.id,
      performedBy: result.user.id,
      action: UserAuditAction.create,
      entityName: 'User',
      entityId: result.user.id,
      newValue: { email, companyId: result.company.id },
    });

    return this.createAuthSession(result.user.id, result.company.id);
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.authRepository.findActiveUserWithAuth(email);

    if (!user?.authentication) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(dto.password, user.authentication.passwordHash);
    if (!valid) {
      await this.authRepository.recordFailedLogin(user.userId.toString());
      throw new UnauthorizedException('Invalid email or password');
    }

    const memberships = await this.authRepository.findUserCompanies(user.userId.toString());
    const active = memberships.filter((m) => m.status === 'active');
    if (active.length === 0) {
      throw new UnauthorizedException('No active company membership found');
    }

    let targetCompanyId = dto.companyId;

    if (targetCompanyId) {
      const belongs = active.some((m) => m.companyId.toString() === targetCompanyId);
      if (!belongs) {
        throw new UnauthorizedException('You do not belong to the selected company');
      }
    } else if (active.length > 1) {
      const roles = await Promise.all(
        active.map(async (m) => {
          const ctx = await this.authRepository.findMembershipWithPermissions(
            user.userId.toString(),
            m.companyId.toString(),
          );
          return {
            id: m.company.companyId.toString(),
            name: m.company.name,
            companyCode: m.company.companyCode,
            roleName: ctx?.role?.roleName ?? 'Member',
          };
        }),
      );

      throw new BadRequestException({
        message: 'Multiple companies found. Please provide companyId.',
        companies: roles,
      });
    } else {
      targetCompanyId = active[0].companyId.toString();
    }

    await this.authRepository.updateLastLogin(user.userId.toString());

    await this.auditService.log({
      companyId: targetCompanyId!,
      userId: user.userId.toString(),
      performedBy: user.userId.toString(),
      action: UserAuditAction.login,
      entityName: 'User',
      entityId: user.userId.toString(),
    });

    return this.createAuthSession(user.userId.toString(), targetCompanyId!);
  }

  async refresh(refreshToken: string) {
    const sessionId = await this.redisService.get(`refresh:${refreshToken}`);
    if (!sessionId) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const sessionRaw = await this.redisService.get(`session:${sessionId}`);
    if (!sessionRaw) {
      throw new UnauthorizedException('Session expired');
    }

    const session: SessionData = JSON.parse(sessionRaw);
    const valid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.redisService.del(`refresh:${refreshToken}`);
    return this.createAuthSession(session.userId, session.companyId, sessionId);
  }

  async logout(refreshToken: string, userId: string, companyId: string) {
    const sessionId = await this.redisService.get(`refresh:${refreshToken}`);
    if (sessionId) {
      await this.redisService.del(`session:${sessionId}`);
      await this.redisService.del(`refresh:${refreshToken}`);
    }

    await this.auditService.log({
      companyId,
      userId,
      performedBy: userId,
      action: UserAuditAction.logout,
      entityName: 'User',
      entityId: userId,
    });

    return { message: 'Logged out successfully' };
  }

  async getMe(userId: string, companyId: string) {
    const membership = await this.authRepository.findMembershipWithPermissions(userId, companyId);
    if (!membership) {
      throw new NotFoundException('User profile');
    }

    const companies = await this.authRepository.findUserCompanies(userId);

    return {
      user: {
        id: membership.user.userId.toString(),
        email: membership.user.email,
        firstName: membership.user.firstName ?? '',
        lastName: membership.user.lastName ?? '',
      },
      company: {
        id: membership.company.companyId.toString(),
        name: membership.company.name,
        companyCode: membership.company.companyCode,
      },
      role: membership.role
        ? { id: membership.role.roleId.toString(), name: membership.role.roleName }
        : null,
      permissions: membership.permissions,
      companies: await Promise.all(
        companies.map(async (m) => {
          const ctx = await this.authRepository.findMembershipWithPermissions(
            userId,
            m.companyId.toString(),
          );
          return {
            id: m.company.companyId.toString(),
            name: m.company.name,
            companyCode: m.company.companyCode,
            roleName: ctx?.role?.roleName ?? 'Member',
          };
        }),
      ),
    };
  }

  async getMyCompanies(userId: string) {
    const memberships = await this.authRepository.findUserCompanies(userId);
    return Promise.all(
      memberships.map(async (m) => {
        const ctx = await this.authRepository.findMembershipWithPermissions(
          userId,
          m.companyId.toString(),
        );
        return {
          id: m.company.companyId.toString(),
          name: m.company.name,
          companyCode: m.company.companyCode,
          roleName: ctx?.role?.roleName ?? 'Member',
        };
      }),
    );
  }

  async switchCompany(userId: string, companyId: string) {
    const membership = await this.authRepository.findMembership(userId, companyId);
    if (!membership) {
      throw new NotFoundException('Company membership');
    }
    return this.createAuthSession(userId, companyId);
  }

  async validateSession(sessionId: string): Promise<boolean> {
    const session = await this.redisService.get(`session:${sessionId}`);
    return !!session;
  }

  async getUserContext(
    userId: string,
    companyId: string,
    sessionId: string,
  ): Promise<AuthenticatedUser | null> {
    const membership = await this.authRepository.findMembershipWithPermissions(userId, companyId);
    if (!membership) return null;

    return {
      sub: userId,
      email: membership.user.email,
      companyId,
      sessionId,
      firstName: membership.user.firstName ?? '',
      lastName: membership.user.lastName ?? '',
      permissions: membership.permissions,
    };
  }

  private async createAuthSession(
    userId: string,
    companyId: string,
    existingSessionId?: string,
  ) {
    const membership = await this.authRepository.findMembershipWithPermissions(userId, companyId);
    if (!membership) {
      throw new UnauthorizedException('Unable to create session');
    }

    const companies = await this.authRepository.findUserCompanies(userId);
    const sessionId = existingSessionId ?? uuidv4();
    const refreshToken = uuidv4();
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    const payload: JwtPayload = {
      sub: userId,
      email: membership.user.email,
      companyId,
      sessionId,
    };

    const accessToken = this.jwtService.sign(payload);
    const expiresIn = this.configService.get<string>('jwt.accessExpiration') || '15m';

    await this.redisService.set(
      `session:${sessionId}`,
      JSON.stringify({ userId, companyId, refreshTokenHash }),
      this.refreshTtlSeconds,
    );
    await this.redisService.set(`refresh:${refreshToken}`, sessionId, this.refreshTtlSeconds);

    await this.authRepository.createSession({
      userId: BigInt(userId),
      companyId: BigInt(companyId),
      refreshToken,
      sessionStatus: 'active',
    });

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      user: {
        id: userId,
        email: membership.user.email,
        firstName: membership.user.firstName ?? '',
        lastName: membership.user.lastName ?? '',
      },
      company: {
        id: membership.company.companyId.toString(),
        name: membership.company.name,
        companyCode: membership.company.companyCode,
      },
      role: membership.role
        ? { id: membership.role.roleId.toString(), name: membership.role.roleName }
        : null,
      permissions: membership.permissions,
      companies: await Promise.all(
        companies.map(async (m) => {
          const ctx = await this.authRepository.findMembershipWithPermissions(
            userId,
            m.companyId.toString(),
          );
          return {
            id: m.company.companyId.toString(),
            name: m.company.name,
            companyCode: m.company.companyCode,
            roleName: ctx?.role?.roleName ?? 'Member',
          };
        }),
      ),
    };
  }
}
