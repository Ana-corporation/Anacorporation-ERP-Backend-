import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  BusinessException,
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import {
  AssignUserRoleDto,
  CreateUserDto,
  InviteUserDto,
  UpdateUserDto,
} from './dto/user.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly tempPasswordTtlHours: number;

  constructor(
    private readonly repository: UsersRepository,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<number>('auth.tempPasswordTtlHours');
    this.tempPasswordTtlHours =
      typeof raw === 'number' && Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 24;
  }
  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(toPaginatedResult(items, total, page, limit));
  }

  async findOne(id: string) {
    const user = await this.repository.findById(id);
    if (!user) throw new NotFoundException('User');
    return serialize(user);
  }

  async create(companyId: string, dto: CreateUserDto, actorId: string) {
    const existing = await this.repository.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.repository.create(dto, companyId, passwordHash, actorId);

    await this.auditService.log({
      companyId,
      userId: user.userId.toString(),
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'User',
      entityId: user.userId.toString(),
    });

    return serialize(user);
  }

  /**
   * Company Admin invite — FE does not collect username/password.
   * Backend generates credentials for new users.
   */
  async invite(companyId: string, dto: InviteUserDto, actorId: string) {
    const email = dto.email.trim().toLowerCase();
    const roleId = dto.roleId ?? null;

    if (roleId) {
      const role = await this.repository.findCompanyRole(companyId, roleId);
      if (!role) {
        throw new BusinessException('roleId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'roleId', message: 'Invalid role for company' },
        ]);
      }
    }

    const existingUser = await this.repository.findByEmail(email);
    let temporaryPassword: string | null = null;
    let userId: string;

    if (!existingUser) {
      temporaryPassword = this.generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      const username = await this.allocateUsername(email);
      const passwordExpiresDate = new Date(
        Date.now() + this.tempPasswordTtlHours * 60 * 60 * 1000,
      );

      const created = await this.repository.createInvitedUser({
        companyId,
        username,
        email,
        firstName: dto.firstName.trim(),
        lastName: (dto.lastName ?? '').trim(),
        mobile: dto.mobile ?? null,
        employeeId: dto.employeeId ?? null,
        passwordHash,
        passwordExpiresDate,
        createdBy: actorId,
      });
      userId = created.user.userId.toString();
      this.logger.log(
        `Invite temp password expires at ${passwordExpiresDate.toISOString()} (TTL ${this.tempPasswordTtlHours}h)`,
      );    } else {
      userId = existingUser.userId.toString();
      const membership = await this.repository.findMembership(userId, companyId);
      if (membership) {
        throw new ConflictException('User is already a member of this company');
      }

      await this.repository.attachMembership({
        userId,
        companyId,
        employeeId: dto.employeeId ?? null,
        createdBy: actorId,
      });

      // Refresh profile fields if invite provides newer name/mobile
      await this.repository.update(
        userId,
        {
          firstName: dto.firstName.trim(),
          lastName: (dto.lastName ?? '').trim() || undefined,
          mobile: dto.mobile ?? undefined,
        },
        actorId,
      );
    }

    if (roleId) {
      await this.repository.assignRole(userId, companyId, roleId, actorId);
    }

    if (dto.sendInviteEmail) {
      this.logger.log(
        `Invite email stub → ${email} (company ${companyId})${
          temporaryPassword ? ' [temp password generated]' : ''
        }`,
      );
    }

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'UserInvite',
      entityId: userId,
      newValue: {
        email,
        roleId,
        sendInviteEmail: dto.sendInviteEmail ?? true,
        isNewUser: temporaryPassword !== null,
      },
    });

    const detail = await this.repository.findCompanyUserDetail(userId, companyId);
    if (!detail) throw new NotFoundException('User');

    return serialize({
      user: this.toInviteUserPayload(detail),
      temporaryPassword,
    });
  }

  async update(id: string, companyId: string, dto: UpdateUserDto, actorId: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('User');

    const user = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      userId: id,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'User',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(user);
  }

  async remove(id: string, companyId: string, actorId: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundException('User');

    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      userId: id,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'User',
      entityId: id,
    });

    return { message: 'User deleted' };
  }

  async assignRole(
    userId: string,
    companyId: string,
    dto: AssignUserRoleDto,
    actorId: string,
  ) {
    const user = await this.repository.findById(userId);
    if (!user) throw new NotFoundException('User');

    const role = await this.repository.findCompanyRole(companyId, dto.roleId);
    if (!role) {
      throw new BusinessException('roleId must belong to this company', HttpStatus.BAD_REQUEST, [
        { field: 'roleId', message: 'Invalid role for company' },
      ]);
    }

    const assignment = await this.repository.assignRole(userId, companyId, dto.roleId, actorId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.role_change,
      entityName: 'UserRole',
      entityId: assignment.userRoleId.toString(),
      newValue: { roleId: dto.roleId },
    });

    return serialize(assignment);
  }

  private async allocateUsername(email: string): Promise<string> {
    const local = email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 80);
    const base = local.length > 0 ? local : `user${Date.now().toString().slice(-6)}`;

    let candidate = base.slice(0, 100);
    let n = 0;
    while (await this.repository.findByUsername(candidate)) {
      n += 1;
      const suffix = String(n);
      candidate = `${base.slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;
    }
    return candidate;
  }

  /** Meets passwordSchema: 8+ chars, upper, lower, digit. Avoids & ^ which break copy/paste. */
  private generateTemporaryPassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '@$!%*?#_-';
    const all = upper + lower + digits + symbols;
    const pick = (set: string) => set[randomBytes(1)[0] % set.length];

    const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
    for (let i = 0; i < 8; i++) chars.push(pick(all));

    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomBytes(1)[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  private toInviteUserPayload(detail: {
    userId: bigint;
    username: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
    mobile: string | null;
    isActive: boolean;
    companies: Array<{
      userCompanyId: bigint;
      employeeId: string | null;
      departmentId: bigint | null;
      designationId: bigint | null;
      branchId: bigint | null;
      warehouseId: bigint | null;
      status: string;
      isDefault: boolean;
    }>;
    roles: Array<{
      role: { roleId: bigint; roleCode: string; roleName: string };
    }>;
  }) {
    const membership = detail.companies[0] ?? null;
    const role = detail.roles[0]?.role ?? null;

    return {
      userId: detail.userId.toString(),
      username: detail.username,
      displayName: detail.displayName,
      firstName: detail.firstName,
      lastName: detail.lastName,
      email: detail.email,
      mobile: detail.mobile,
      isActive: detail.isActive,
      membership: membership
        ? {
            userCompanyId: membership.userCompanyId.toString(),
            employeeId: membership.employeeId,
            departmentId: membership.departmentId?.toString() ?? null,
            designationId: membership.designationId?.toString() ?? null,
            branchId: membership.branchId?.toString() ?? null,
            warehouseId: membership.warehouseId?.toString() ?? null,
            status: membership.status,
            isDefault: membership.isDefault,
          }
        : null,
      role: role
        ? {
            roleId: role.roleId.toString(),
            roleCode: role.roleCode,
            roleName: role.roleName,
          }
        : null,
    };
  }
}
