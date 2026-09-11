import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { AuthenticatedUser, JwtPayload } from '@/common/interfaces/auth.interface';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@/common/exceptions/business.exception';
import { LoginDto, ChangePasswordDto } from './dto/auth.dto';
import { AuthRepository } from './auth.repository';
import { CompanyAccessContextService } from './company-access-context.service';
import { AuthSessionService } from './auth-session.service';
import { CompanySecurityPolicyService } from './company-security-policy.service';
import { UserContextCacheService } from './user-context-cache.service';
import { RoleLoginResponseBuilder } from './role-access/role-login-response.builder';

export interface AuthClientMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly companyAccessContextService: CompanyAccessContextService,
    private readonly authSessionService: AuthSessionService,
    private readonly securityPolicyService: CompanySecurityPolicyService,
    private readonly userContextCache: UserContextCacheService,
    private readonly roleLoginResponseBuilder: RoleLoginResponseBuilder,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  /** Never fail auth because catalog backfill hiccuped — log and continue. */
  private async safeEnsurePermissionsSeeded(context: string) {
    try {
      await this.authRepository.ensurePermissionsSeeded();
    } catch (err) {
      this.logger.error(
        `ensurePermissionsSeeded failed during ${context}; continuing without blocking auth`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async resolveCompanyForLogin(companyId?: string, companyCode?: string) {
    let company = null as Awaited<ReturnType<AuthRepository['findCompanyByCode']>>;

    if (companyId) {
      company = await this.authRepository.findCompanyById(companyId);
    } else if (companyCode) {
      company = await this.authRepository.findCompanyByCode(companyCode);
    }

    if (!company) {
      throw new BadRequestException('Company not found');
    }
    if (company.status === 'suspended') {
      throw new ForbiddenException('Company account is suspended');
    }
    if (company.status === 'cancelled') {
      throw new ForbiddenException('Company account is cancelled');
    }

    return company;
  }

  async getPublicCompanyByCode(companyCode: string) {
    const company = await this.authRepository.findCompanyByCode(companyCode);
    if (!company) {
      throw new NotFoundException('Company');
    }

    return {
      companyId: company.companyId.toString(),
      companyCode: company.companyCode,
      name: company.name,
      status: company.status,
    };
  }

  async login(dto: LoginDto, meta: AuthClientMeta = {}) {
    const company = await this.resolveCompanyForLogin(dto.companyId, dto.companyCode);
    const companyId = company.companyId.toString();
    const browser = this.parseBrowser(meta.userAgent);

    const membership = await this.authRepository.findMembershipByEmployeeCode(
      companyId,
      dto.employeeCode,
    );

    if (!membership) {
      await this.authRepository.recordLoginHistory({
        companyId,
        loginResult: 'failure',
        failureReason: 'Invalid employee code or password',
        ipAddress: meta.ipAddress,
        browser,
      });
      throw new UnauthorizedException('Invalid employee code or password');
    }

    const user = membership.user;
    await this.securityPolicyService.assertLoginAllowed(user.userId.toString());

    if (!user.isActive || user.isLocked) {
      await this.authRepository.recordLoginHistory({
        userId: user.userId.toString(),
        companyId,
        loginResult: 'failure',
        failureReason: user.isLocked ? 'Account locked' : 'Account inactive',
        ipAddress: meta.ipAddress,
        browser,
      });
      throw new UnauthorizedException(
        user.isLocked ? 'Account is locked' : 'Account is inactive',
      );
    }

    if (!user.authentication) {
      await this.authRepository.recordLoginHistory({
        userId: user.userId.toString(),
        companyId,
        loginResult: 'failure',
        failureReason: 'Authentication record missing',
        ipAddress: meta.ipAddress,
        browser,
      });
      throw new UnauthorizedException('Invalid employee code or password');
    }

    const valid = await bcrypt.compare(dto.password, user.authentication.passwordHash);
    if (!valid) {
      await this.securityPolicyService.recordFailedLogin(user.userId.toString(), companyId);
      await this.authRepository.recordLoginHistory({
        userId: user.userId.toString(),
        companyId,
        loginResult: 'failure',
        failureReason: 'Invalid password',
        ipAddress: meta.ipAddress,
        browser,
      });
      throw new UnauthorizedException('Invalid employee code or password');
    }

    const auth = user.authentication;
    if (
      auth.mustChangePassword &&
      auth.passwordExpiresDate &&
      auth.passwordExpiresDate.getTime() < Date.now()
    ) {
      await this.authRepository.recordLoginHistory({
        userId: user.userId.toString(),
        companyId,
        loginResult: 'failure',
        failureReason: 'Temporary password expired',
        ipAddress: meta.ipAddress,
        browser,
      });
      throw new HttpException(
        {
          message: 'Temporary password has expired. Ask your admin to invite again.',
          code: 'TEMP_PASSWORD_EXPIRED',
          statusCode: HttpStatus.UNAUTHORIZED,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.authRepository.updateLastLogin(user.userId.toString());

    await this.authRepository.recordLoginHistory({
      userId: user.userId.toString(),
      companyId,
      loginResult: 'success',
      ipAddress: meta.ipAddress,
      browser,
    });

    await this.auditService.log({
      companyId,
      userId: user.userId.toString(),
      performedBy: user.userId.toString(),
      action: UserAuditAction.login,
      entityName: 'User',
      entityId: user.userId.toString(),
    });

    return this.createAuthSession(user.userId.toString(), companyId, undefined, meta);
  }

  async loginOAuthUser(
    userId: string,
    companyId: string,
    meta: AuthClientMeta = {},
  ) {
    await this.securityPolicyService.assertLoginAllowed(userId);

    const membership = await this.authRepository.findMembershipByUserAndCompany(
      userId,
      companyId,
    );
    if (!membership) {
      throw new UnauthorizedException('User is not a member of this company');
    }

    const user = membership.user;
    if (!user.isActive || user.isLocked) {
      throw new UnauthorizedException(
        user.isLocked ? 'Account is locked' : 'Account is inactive',
      );
    }

    await this.authRepository.updateLastLogin(userId);
    await this.authRepository.recordLoginHistory({
      userId,
      companyId,
      loginResult: 'success',
      ipAddress: meta.ipAddress,
      browser: this.parseBrowser(meta.userAgent),
    });

    return this.createAuthSession(userId, companyId, undefined, meta);
  }

  async refresh(refreshToken: string, meta: AuthClientMeta = {}) {
    const rotation = await this.authSessionService.rotateCompanyRefresh(refreshToken);
    await this.authRepository.revokeSessionsByRefreshToken(refreshToken);

    return this.createAuthSession(
      rotation.userId,
      rotation.companyId,
      rotation.sessionId,
      meta,
      rotation.tokenFamilyId,
    );
  }

  async logout(refreshToken: string | undefined, userId: string, companyId: string, sid?: string) {
    if (refreshToken) {
      await this.authSessionService.revokeCompanySessionByRefreshToken(refreshToken);
      await this.authRepository.revokeSessionsByRefreshToken(refreshToken);
    }

    if (sid) {
      await this.authSessionService.revokeCompanySessionById(sid);
      await this.authRepository.revokeSessionBySid(sid);
    }

    await this.userContextCache.invalidate(userId, companyId);

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
    // Backfill Security Org V1 codes onto existing ADMIN roles before reading permissions[].
    // Must not throw — concurrent login+/me previously timed out /me with 500.
    await this.safeEnsurePermissionsSeeded('GET /auth/me');

    const accessContext = await this.companyAccessContextService.buildCompanyAccessContext(
      userId,
      companyId,
    );
    const membership = await this.authRepository.findMembershipWithPermissions(userId, companyId);
    const mustChangePassword = await this.authRepository.getMustChangePassword(userId);

    const snapshot = this.roleLoginResponseBuilder.build({
      accessContext,
      rolePermissions: membership?.permissions ?? [],
      mustChangePassword,
    });

    return this.roleLoginResponseBuilder.toMePayload(snapshot);
  }

  async getMyProfile(userId: string, companyId: string) {
    const me = await this.getMe(userId, companyId);
    return {
      user: me.user,
      membership: me.activeCompany.membership ?? null,
      role: me.activeCompany.role,
    };
  }

  async changePassword(
    userId: string,
    companyId: string,
    dto: ChangePasswordDto,
    currentSessionId?: string,
  ) {
    const auth = await this.authRepository.findAuthenticationByUserId(userId);
    if (!auth?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const mustChangePassword = Boolean(auth.mustChangePassword);
    if (!mustChangePassword) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Current password is required');
      }
      const currentOk = await bcrypt.compare(dto.currentPassword, auth.passwordHash);
      if (!currentOk) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    }

    if (dto.currentPassword && dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.authRepository.changePassword({
      userId,
      newPasswordHash,
      previousPasswordHash: auth.passwordHash,
      changedBy: userId,
    });

    await this.userContextCache.invalidate(userId, companyId);
    if (currentSessionId) {
      await this.authSessionService.revokeOtherCompanySessions(
        userId,
        companyId,
        currentSessionId,
      );
    }

    await this.auditService.log({
      companyId,
      userId,
      performedBy: userId,
      action: UserAuditAction.password_change,
      entityName: 'UserAuthentication',
      entityId: userId,
    });

    return { mustChangePassword: false };
  }

  async getMyCompanies(userId: string) {
    const memberships = await this.authRepository.findUserCompanies(userId);
    return memberships
      .filter((m) => m.status === 'active')
      .map((m) => ({
        companyId: m.company.companyId.toString(),
        companyCode: m.company.companyCode,
        name: m.company.name,
        isDefault: m.isDefault,
        status: m.company.status,
        employeeCode: m.employeeId,
      }));
  }

  async switchCompany(
    userId: string,
    companyId: string,
    meta: AuthClientMeta = {},
    currentSessionId?: string,
  ) {
    await this.companyAccessContextService.buildCompanyAccessContext(userId, companyId);

    if (currentSessionId) {
      await this.authSessionService.revokeCompanySessionById(currentSessionId);
      await this.authRepository.revokeSessionBySid(currentSessionId);
    }

    await this.userContextCache.invalidate(userId, companyId);
    return this.createAuthSession(userId, companyId, undefined, meta);
  }

  async validateSession(sessionId: string): Promise<boolean> {
    return this.authSessionService.validateCompanySession(sessionId);
  }

  async getUserContext(
    userId: string,
    companyId: string,
    sessionId: string,
  ): Promise<AuthenticatedUser | null> {
    const valid = await this.authSessionService.validateCompanySession(sessionId);
    if (!valid) return null;

    const cached = await this.userContextCache.get(userId, companyId);
    if (cached && cached.sessionId === sessionId) {
      return cached;
    }

    const membership = await this.authRepository.findMembershipWithPermissions(userId, companyId);
    if (!membership) return null;

    const accessContext = await this.companyAccessContextService.buildCompanyAccessContext(
      userId,
      companyId,
    );
    const mustChangePassword = await this.authRepository.getMustChangePassword(userId);

    const context: AuthenticatedUser = {
      sub: userId,
      email: membership.user.email,
      companyId,
      sessionId,
      role: accessContext.activeCompany.role?.roleCode,
      firstName: membership.user.firstName ?? '',
      lastName: membership.user.lastName ?? '',
      permissions: membership.permissions,
      modules: accessContext.activeCompany.modules,
      subscriptionStatus: accessContext.activeCompany.subscription.status,
      mustChangePassword,
    };

    await this.userContextCache.set(userId, companyId, context);
    return context;
  }

  invalidateUserContextCache(userId: string, companyId: string) {
    return this.userContextCache.invalidate(userId, companyId);
  }

  private async createAuthSession(
    userId: string,
    companyId: string,
    existingSessionId?: string,
    meta: AuthClientMeta = {},
    existingFamilyId?: string,
  ) {
    // Login / refresh / switch-company: seed catalog + grant V1 codes to roleCode ADMIN
    // before permissions[] is built (existing DEMO admins never went through signup seed).
    await this.safeEnsurePermissionsSeeded('createAuthSession');

    const policy = await this.securityPolicyService.getPolicyForCompany(companyId);

    await this.authSessionService.enforceConcurrentSessionPolicy(
      userId,
      companyId,
      policy.allowMultipleLogins,
      policy.maxConcurrentSessions,
    );

    const session = await this.authSessionService.createCompanySession({
      userId,
      companyId,
      sessionTimeoutMin: policy.sessionTimeoutMin,
      existingSessionId,
      existingFamilyId,
    });

    const accessContext = await this.companyAccessContextService.buildCompanyAccessContext(
      userId,
      companyId,
    );
    const membership = await this.authRepository.findMembershipWithPermissions(userId, companyId);
    const rolePermissions = membership?.permissions ?? [];
    const mustChangePassword = await this.authRepository.getMustChangePassword(userId);

    const snapshot = this.roleLoginResponseBuilder.build({
      accessContext,
      rolePermissions,
      mustChangePassword,
    });

    const payload: JwtPayload = {
      sub: userId,
      email: accessContext.user.email,
      cid: companyId,
      sid: session.sid,
      role: accessContext.activeCompany.role?.roleCode,
      companyId,
      sessionId: session.sid,
    };

    const accessToken = this.jwtService.sign(payload);
    const expiresIn = this.configService.get<string>('jwt.accessExpiration') || '8h';

    await this.authRepository.createSession({
      userId: BigInt(userId),
      companyId: BigInt(companyId),
      refreshToken: session.refreshToken,
      jwtToken: session.sid,
      sessionStatus: 'active',
      ipAddress: meta.ipAddress,
      browser: this.parseBrowser(meta.userAgent),
    });

    await this.userContextCache.invalidate(userId, companyId);

    // FE snapshot is role-shaped; JWT/cache keeps full DB permissions for API guards.
    return this.roleLoginResponseBuilder.toLoginPayload(snapshot, {
      accessToken,
      refreshToken: session.refreshToken,
      expiresIn,
    });
  }

  private parseBrowser(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;
    if (userAgent.length > 80) return userAgent.slice(0, 80);
    return userAgent;
  }
}
