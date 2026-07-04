import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { UserAuditAction } from '@prisma/client';
import { RedisService } from '@/infrastructure/redis/redis.service';
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
import { CreateSuperAdminDto, SuperAdminLoginDto, UpdateSuperAdminDto } from './dto/super-admin.dto';
import { SuperAdminsRepository } from './super-admins.repository';

interface SuperAdminSession {
  superAdminId: string;
  refreshTokenHash: string;
}

@Injectable()
export class SuperAdminAuthService {
  private readonly refreshTtlSeconds = 7 * 24 * 60 * 60;

  constructor(
    private readonly repository: SuperAdminsRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async validateSession(sessionId: string): Promise<boolean> {
    const session = await this.redisService.get(`super-admin-session:${sessionId}`);
    return !!session;
  }

  async resolveUser(payload: JwtPayload): Promise<AuthenticatedUser | null> {
    if (payload.role !== 'super_admin') return null;

    const admin = await this.repository.findById(payload.sub);
    if (!admin || !admin.isActive) return null;

    return {
      sub: payload.sub,
      email: payload.email,
      sessionId: payload.sessionId,
      role: 'super_admin',
      permissions: [...SUPER_ADMIN_PERMISSIONS],
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

    const valid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.repository.updateLastLogin(admin.superAdminId.toString());

    return this.createSession(admin.superAdminId.toString(), admin.email, admin.name);
  }

  private async createSession(superAdminId: string, email: string, name: string) {
    const sessionId = uuidv4();
    const refreshToken = uuidv4();
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    const payload: JwtPayload = {
      sub: superAdminId,
      email,
      sessionId,
      role: 'super_admin',
    };

    const accessToken = this.jwtService.sign(payload);
    const expiresIn = this.configService.get<string>('jwt.accessExpiration') || '15m';

    await this.redisService.set(
      `super-admin-session:${sessionId}`,
      JSON.stringify({ superAdminId, refreshTokenHash } satisfies SuperAdminSession),
      this.refreshTtlSeconds,
    );
    await this.redisService.set(`super-admin-refresh:${refreshToken}`, sessionId, this.refreshTtlSeconds);

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      role: 'super_admin',
      user: { id: superAdminId, email, name },
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
