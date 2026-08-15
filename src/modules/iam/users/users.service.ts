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
import { UserContextCacheService } from '@/modules/iam/authentication/user-context-cache.service';
import { EmployeesService } from '@/modules/organization/employees/employees.service';
import {
  AssignUserRoleDto,
  CreateUserDto,
  InviteUserDto,
  ReplaceModuleAccessDto,
  UpdateMembershipDto,
  UpdateMembershipStatusDto,
  UpdateUserDto,
} from './dto/user.dto';
import { UsersRepository } from './users.repository';

const LAST_ADMIN_MESSAGE =
  'You cannot remove or deactivate the last administrator of this company.';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly tempPasswordTtlHours: number;

  constructor(
    private readonly repository: UsersRepository,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly userContextCache: UserContextCacheService,
    private readonly employeesService: EmployeesService,
  ) {
    const raw = this.configService.get<number>('auth.tempPasswordTtlHours');
    this.tempPasswordTtlHours =
      typeof raw === 'number' && Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 24;
  }
  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(companyId, query);
    return serialize(
      toPaginatedResult(
        items.map((item) => this.toInviteUserPayload(item)),
        total,
        page,
        limit,
      ),
    );
  }

  async findOne(id: string, companyId?: string) {
    if (companyId) {
      const detail = await this.repository.findCompanyUserDetail(id, companyId);
      if (!detail) throw new NotFoundException('User');
      return serialize(this.toInviteUserPayload(detail));
    }

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

    // Keep current temp-password invite. Optionally sync employees master.
    const personType =
      dto.personType ??
      (dto.employeeRecordId || dto.employeeId ? 'EMPLOYEE' : 'EXTERNAL');
    if (personType === 'EMPLOYEE') {
      if (!dto.employeeRecordId && !dto.employeeId) {
        throw new BusinessException(
          'EMPLOYEE invite requires employeeId (code) or employeeRecordId',
          HttpStatus.BAD_REQUEST,
          [{ field: 'employeeId', message: 'Required for employee invite' }],
        );
      }
      const employee = await this.employeesService.ensureLinkedForInvite({
        companyId,
        userId,
        actorId,
        employeeRecordId: dto.employeeRecordId ?? null,
        employeeCode: dto.employeeId ?? null,
        firstName: dto.firstName.trim(),
        lastName: (dto.lastName ?? '').trim() || null,
        email,
        mobile: dto.mobile ?? null,
      });
      // If existing employee was selected, keep membership login code in sync.
      if (employee && !dto.employeeId) {
        await this.repository.updateMembership(
          userId,
          companyId,
          { employeeId: employee.employeeCode },
          actorId,
        );
      }
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
    const existing = await this.requireCompanyUser(id, companyId);
    const firstName = dto.firstName !== undefined ? dto.firstName : existing.firstName;
    const lastName = dto.lastName !== undefined ? dto.lastName : existing.lastName;
    const displayName =
      [firstName, lastName].filter(Boolean).join(' ').trim() || existing.username;

    await this.repository.update(id, dto, actorId, displayName);

    await this.auditService.log({
      companyId,
      userId: id,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'User',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    return this.serializeCompanyUser(id, companyId);
  }

  async remove(id: string, companyId: string, actorId: string) {
    await this.requireCompanyUser(id, companyId);
    await this.assertNotLastAdmin(id, companyId);

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
    await this.requireCompanyUser(userId, companyId);

    const roleId = dto.roleId ?? null;
    let nextRoleCode: string | null = null;
    if (roleId) {
      const role = await this.repository.findCompanyRole(companyId, roleId);
      if (!role) {
        throw new BusinessException('roleId must belong to this company', HttpStatus.BAD_REQUEST, [
          { field: 'roleId', message: 'Invalid role for company' },
        ]);
      }
      nextRoleCode = role.roleCode;
    }

    const currentAdmin = await this.repository.findActiveAdminRole(userId, companyId);
    if (currentAdmin && nextRoleCode !== 'ADMIN') {
      await this.assertNotLastAdmin(userId, companyId);
    }

    const assignment = await this.repository.replacePrimaryRole(
      userId,
      companyId,
      roleId,
      actorId,
    );
    await this.userContextCache.invalidate(userId, companyId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.role_change,
      entityName: 'UserRole',
      entityId: assignment?.userRoleId.toString() ?? userId,
      newValue: { roleId },
    });

    return this.serializeCompanyUser(userId, companyId);
  }

  async updateMembership(
    userId: string,
    companyId: string,
    dto: UpdateMembershipDto,
    actorId: string,
  ) {
    await this.requireCompanyUser(userId, companyId);
    await this.assertMembershipOrgRefs(companyId, dto);

    const result = await this.repository.updateMembership(
      userId,
      companyId,
      {
        employeeId: dto.employeeId,
        departmentId: dto.departmentId,
        designationId: dto.designationId,
        branchId: dto.branchId,
        warehouseId: dto.warehouseId,
      },
      actorId,
    );
    if (result.count === 0) throw new NotFoundException('User');

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserCompany',
      entityId: userId,
      newValue: dto as Record<string, unknown>,
    });

    return this.serializeCompanyUser(userId, companyId);
  }

  async updateMembershipStatus(
    userId: string,
    companyId: string,
    dto: UpdateMembershipStatusDto,
    actorId: string,
  ) {
    await this.requireCompanyUser(userId, companyId);

    if (dto.status === 'suspended') {
      await this.assertNotLastAdmin(userId, companyId);
    }

    const result = await this.repository.updateMembership(
      userId,
      companyId,
      { status: dto.status },
      actorId,
    );
    if (result.count === 0) throw new NotFoundException('User');

    await this.userContextCache.invalidate(userId, companyId);
    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserCompany',
      entityId: userId,
      newValue: { status: dto.status },
    });

    return this.serializeCompanyUser(userId, companyId);
  }

  async replaceModuleAccess(
    userId: string,
    companyId: string,
    dto: ReplaceModuleAccessDto,
    actorId: string,
  ) {
    await this.requireCompanyUser(userId, companyId);

    const items = dto.items ?? [];
    if (items.length > 0) {
      const uniqueIds = [...new Set(items.map((item) => item.moduleId))];
      const found = await this.repository.findModulesByIds(uniqueIds);
      if (found.length !== uniqueIds.length) {
        throw new BusinessException('One or more moduleId values are invalid', HttpStatus.BAD_REQUEST, [
          { field: 'items.moduleId', message: 'Module not found' },
        ]);
      }
    }

    await this.repository.replaceModuleAccess(userId, companyId, items, actorId);
    await this.userContextCache.invalidate(userId, companyId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserModuleAccess',
      entityId: userId,
      newValue: { items },
    });

    return this.serializeCompanyUser(userId, companyId);
  }

  private async requireCompanyUser(userId: string, companyId: string) {
    const detail = await this.repository.findCompanyUserDetail(userId, companyId);
    if (!detail) throw new NotFoundException('User');
    return detail;
  }

  private async serializeCompanyUser(userId: string, companyId: string) {
    const detail = await this.requireCompanyUser(userId, companyId);
    return serialize(this.toInviteUserPayload(detail));
  }

  private async assertMembershipOrgRefs(companyId: string, dto: UpdateMembershipDto) {
    const checks: Array<{
      kind: 'department' | 'designation' | 'branch' | 'warehouse';
      id?: string | null;
      field: string;
    }> = [
      { kind: 'department', id: dto.departmentId, field: 'departmentId' },
      { kind: 'designation', id: dto.designationId, field: 'designationId' },
      { kind: 'branch', id: dto.branchId, field: 'branchId' },
      { kind: 'warehouse', id: dto.warehouseId, field: 'warehouseId' },
    ];

    for (const check of checks) {
      if (!check.id) continue;
      const found = await this.repository.findCompanyOrgRef(check.kind, check.id, companyId);
      if (!found) {
        throw new BusinessException(`${check.field} must belong to this company`, HttpStatus.BAD_REQUEST, [
          { field: check.field, message: 'Invalid id for company' },
        ]);
      }
    }
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
      displayName:
        detail.displayName?.trim() ||
        [detail.firstName, detail.lastName].filter(Boolean).join(' ').trim() ||
        detail.username,
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

  private async assertNotLastAdmin(userId: string, companyId: string) {
    const adminRole = await this.repository.findActiveAdminRole(userId, companyId);
    if (!adminRole) return;
    const others = await this.repository.countOtherActiveAdmins(companyId, userId);
    if (others === 0) {
      throw new ConflictException(LAST_ADMIN_MESSAGE);
    }
  }
}
