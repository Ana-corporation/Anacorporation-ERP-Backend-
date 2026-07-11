import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { SUPER_ADMIN_PERMISSIONS } from '@/common/constants/permissions.constant';
import { AuthenticatedUser, JwtPayload } from '@/common/interfaces/auth.interface';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@/common/exceptions/business.exception';
import { serialize, parseBigIntId } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import { AuthSessionService } from '@/modules/iam/authentication/auth-session.service';
import { CreateSuperAdminDto, SuperAdminLoginDto, UpdateSuperAdminDto } from './dto/super-admin.dto';
import { SUPER_ADMIN_DEFAULT_REDIRECT } from './super-admins.constants';
import { SuperAdminsRepository } from './super-admins.repository';

@Injectable()
export class SuperAdminAuthService {
  constructor(
    private readonly repository: SuperAdminsRepository,
    private readonly authSessionService: AuthSessionService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async validateSession(sessionId: string): Promise<boolean> {
    return this.authSessionService.validateSuperAdminSession(sessionId);
  }

  async resolveUser(payload: JwtPayload): Promise<AuthenticatedUser | null> {
    if (payload.role !== 'super_admin') return null;

    const admin = await this.repository.findById(payload.sub);
    if (!admin || !admin.isActive) return null;

    return {
      sub: payload.sub,
      email: payload.email,
      sessionId: payload.sid ?? payload.sessionId ?? '',
      role: 'super_admin',
      permissions: [...SUPER_ADMIN_PERMISSIONS],
      modules: [],
      subscriptionStatus: 'none',
      firstName: admin.name.split(' ')[0] ?? '',
      lastName: admin.name.split(' ').slice(1).join(' ') ?? '',
    };
  }

  async login(dto: SuperAdminLoginDto) {
    const email = dto.email.trim().toLowerCase();
    const admin = await this.repository.findByEmailWithPassword(email);

    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const valid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.repository.updateLastLogin(admin.superAdminId.toString());

    return this.createSession(admin.superAdminId.toString(), admin.email, admin.name);
  }

  async refresh(refreshToken: string) {
    const rotation = await this.authSessionService.rotateSuperAdminRefresh(refreshToken);

    const admin = await this.repository.findById(rotation.superAdminId);
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    return this.createSession(
      rotation.superAdminId,
      admin.email,
      admin.name,
      rotation.sessionId,
      rotation.tokenFamilyId,
    );
  }

  async logout(refreshToken: string | undefined, superAdminId: string, sid?: string) {
    if (refreshToken) {
      await this.authSessionService.revokeSuperAdminByRefreshToken(refreshToken);
    }

    if (sid) {
      await this.authSessionService.revokeSuperAdminSession(sid);
    }

    return { message: 'Logged out successfully' };
  }

  async getMe(superAdminId: string) {
    const admin = await this.repository.findById(superAdminId);
    if (!admin) {
      throw new NotFoundException('Super admin');
    }

    return {
      role: 'super_admin',
      redirectTo: SUPER_ADMIN_DEFAULT_REDIRECT,
      user: {
        superAdminId: admin.superAdminId.toString(),
        email: admin.email,
        name: admin.name,
        isActive: admin.isActive,
        lastLoginAt: admin.lastLoginAt,
      },
      permissions: [...SUPER_ADMIN_PERMISSIONS],
    };
  }

  private async createSession(
    superAdminId: string,
    email: string,
    name: string,
    existingSessionId?: string,
    existingFamilyId?: string,
  ) {
    const session = await this.authSessionService.createSuperAdminSession({
      superAdminId,
      existingSessionId,
      existingFamilyId,
    });

    const payload: JwtPayload = {
      sub: superAdminId,
      email,
      sid: session.sessionId,
      role: 'super_admin',
    };

    const accessToken = this.jwtService.sign(payload);
    const expiresIn = this.configService.get<string>('jwt.accessExpiration') || '15m';

    return {
      accessToken,
      refreshToken: session.refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      role: 'super_admin',
      redirectTo: SUPER_ADMIN_DEFAULT_REDIRECT,
      user: {
        superAdminId,
        email,
        name,
      },
      permissions: [...SUPER_ADMIN_PERMISSIONS],
    };
  }
}

@Injectable()
export class SuperAdminsService {
  constructor(
    private readonly repository: SuperAdminsRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: Parameters<SuperAdminsRepository['findMany']>[0]) {
    const { items, total, page, limit } = await this.repository.findMany(query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string) {
    const admin = await this.repository.findById(id);
    if (!admin) throw new NotFoundException('Super admin');
    return serialize(admin);
  }

  async bootstrap(dto: CreateSuperAdminDto) {
    const count = await this.repository.countActive();
    if (count > 0) {
      throw new ConflictException('Super admin already exists — use login or create with auth');
    }
    return this.create(dto);
  }

  async create(dto: CreateSuperAdminDto, actorId?: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.repository.findByEmail(email);
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const admin = await this.repository.create(dto, passwordHash, actorId);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'SuperAdmin',
      entityId: admin.superAdminId.toString(),
      newValue: { email, name: admin.name },
    });

    return serialize(admin);
  }

  async update(id: string, dto: UpdateSuperAdminDto, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Super admin');

    if (dto.email) {
      const email = dto.email.trim().toLowerCase();
      const dup = await this.repository.findByEmail(email);
      if (dup && dup.superAdminId.toString() !== id) {
        throw new ConflictException('Email already registered');
      }
    }

    const data: Parameters<SuperAdminsRepository['update']>[1] = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
      ...(dto.isMfaEnabled !== undefined ? { isMfaEnabled: dto.isMfaEnabled } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      updatedBy: actorId ? parseBigIntId(actorId) : undefined,
      updatedAt: new Date(),
    };

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
    }

    const admin = await this.repository.update(id, data);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'SuperAdmin',
      entityId: id,
    });

    return serialize(admin);
  }

  async remove(id: string, actorId?: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('Super admin');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'SuperAdmin',
      entityId: id,
    });

    return { message: 'Super admin deleted' };
  }
}
