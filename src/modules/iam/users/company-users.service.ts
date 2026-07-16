import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import {
  ConflictException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { serialize } from '@/common/utils/bigint.util';
import { toPaginatedResult } from '@/common/utils/pagination.util';
import {
  InviteCompanyUserDto,
  SetCompanyUserModuleAccessDto,
  SetCompanyUserRoleDto,
  SetCompanyUserStatusDto,
  UpdateCompanyUserMembershipDto,
  UpdateCompanyUserProfileDto,
} from './dto/company-user.dto';
import { CompanyUsersRepository } from './company-users.repository';

@Injectable()
export class CompanyUsersService {
  constructor(
    private readonly repository: CompanyUsersRepository,
    private readonly auditService: AuditService,
  ) {}

  private toUserPayload(
    membership: {
      userCompanyId: bigint;
      employeeId: string | null;
      departmentId: bigint | null;
      designationId: bigint | null;
      branchId: bigint | null;
      warehouseId: bigint | null;
      status: string;
      isDefault: boolean;
      user: {
        userId: bigint;
        username: string;
        displayName: string | null;
        firstName: string | null;
        lastName: string | null;
        email: string;
        mobile: string | null;
        isActive: boolean;
      };
    },
    role?: { roleId: bigint; roleCode: string; roleName: string } | null,
  ) {
    return {
      userId: membership.user.userId.toString(),
      username: membership.user.username,
      displayName: membership.user.displayName,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      email: membership.user.email,
      mobile: membership.user.mobile,
      isActive: membership.user.isActive,
      membership: {
        userCompanyId: membership.userCompanyId.toString(),
        employeeId: membership.employeeId,
        departmentId: membership.departmentId?.toString() ?? null,
        designationId: membership.designationId?.toString() ?? null,
        branchId: membership.branchId?.toString() ?? null,
        warehouseId: membership.warehouseId?.toString() ?? null,
        status: membership.status,
        isDefault: membership.isDefault,
      },
      role: role
        ? {
            roleId: role.roleId.toString(),
            roleCode: role.roleCode,
            roleName: role.roleName,
          }
        : null,
    };
  }

  async findAll(
    companyId: string,
    query: PaginationQueryDto & { status?: string; roleId?: string },
  ) {
    const { items, total, page, limit } = await this.repository.findMemberships(companyId, query);
    const roles = await this.repository.findRolesForUsers(
      companyId,
      items.map((m) => m.userId),
    );
    const roleByUser = new Map<string, (typeof roles)[number]['role']>();
    for (const ur of roles) {
      const key = ur.userId.toString();
      if (!roleByUser.has(key)) roleByUser.set(key, ur.role);
    }

    const mapped = items.map((m) =>
      this.toUserPayload(m, roleByUser.get(m.userId.toString()) ?? null),
    );
    return serialize(toPaginatedResult(mapped, total, page, limit));
  }

  async invite(companyId: string, dto: InviteCompanyUserDto, actorId: string) {
    const email = dto.email.trim().toLowerCase();
    if (dto.roleId) {
      const role = await this.repository.findRole(companyId, dto.roleId);
      if (!role) throw new NotFoundException('Role');
    }

    const employeeId = dto.employeeId?.trim() || (await this.repository.nextEmployeeId(companyId));
    const existing = await this.repository.findUserByEmail(email);

    if (existing) {
      const already = await this.repository.findMembership(companyId, existing.userId.toString());
      if (already) throw new ConflictException('User is already a member of this company');

      await this.repository.attachExistingUser({
        userId: existing.userId.toString(),
        companyId,
        employeeId,
        roleId: dto.roleId,
        actorId,
      });

      const membership = await this.repository.findMembership(companyId, existing.userId.toString());
      if (!membership) throw new NotFoundException('User');
      const role = await this.repository.findPrimaryRole(existing.userId.toString(), companyId);

      await this.auditService.log({
        companyId,
        userId: existing.userId.toString(),
        performedBy: actorId,
        action: UserAuditAction.create,
        entityName: 'UserCompany',
        entityId: membership.userCompanyId.toString(),
        newValue: { email, attachedExisting: true },
      });

      return serialize({
        ...this.toUserPayload(membership, role?.role ?? null),
        temporaryPassword: null,
        inviteEmailQueued: Boolean(dto.sendInviteEmail),
      });
    }

    const tempPassword = `Tmp${randomTempSuffix()}!`;
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const username =
      dto.username?.trim() ||
      `${email.split('@')[0]}.${Math.floor(Math.random() * 900 + 100)}`;

    const created = await this.repository.createUserWithMembership({
      email,
      username,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      mobile: dto.mobile,
      passwordHash,
      companyId,
      employeeId,
      roleId: dto.roleId,
      actorId,
    });

    const membership = await this.repository.findMembership(
      companyId,
      created.user.userId.toString(),
    );
    if (!membership) throw new NotFoundException('User');
    const role = await this.repository.findPrimaryRole(created.user.userId.toString(), companyId);

    await this.auditService.log({
      companyId,
      userId: created.user.userId.toString(),
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'User',
      entityId: created.user.userId.toString(),
      newValue: { email, employeeId },
    });

    return serialize({
      ...this.toUserPayload(membership, role?.role ?? null),
      temporaryPassword: tempPassword,
      inviteEmailQueued: Boolean(dto.sendInviteEmail),
    });
  }

  async updateProfile(
    companyId: string,
    userId: string,
    dto: UpdateCompanyUserProfileDto,
    actorId: string,
  ) {
    const membership = await this.repository.findMembership(companyId, userId);
    if (!membership) throw new NotFoundException('User');

    await this.repository.updateProfile(userId, dto, actorId);
    const updated = await this.repository.findMembership(companyId, userId);
    if (!updated) throw new NotFoundException('User');
    const role = await this.repository.findPrimaryRole(userId, companyId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'User',
      entityId: userId,
      newValue: dto as Record<string, unknown>,
    });

    return serialize(this.toUserPayload(updated, role?.role ?? null));
  }

  async setRole(companyId: string, userId: string, dto: SetCompanyUserRoleDto, actorId: string) {
    const membership = await this.repository.findMembership(companyId, userId);
    if (!membership) throw new NotFoundException('User');
    const role = await this.repository.findRole(companyId, dto.roleId);
    if (!role) throw new NotFoundException('Role');

    const assignment = await this.repository.replaceRole(userId, companyId, dto.roleId, actorId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.role_change,
      entityName: 'UserRole',
      entityId: assignment.userRoleId.toString(),
      newValue: { roleId: dto.roleId },
    });

    const updated = await this.repository.findMembership(companyId, userId);
    return serialize(this.toUserPayload(updated!, assignment.role));
  }

  async updateMembership(
    companyId: string,
    userId: string,
    dto: UpdateCompanyUserMembershipDto,
    actorId: string,
  ) {
    const membership = await this.repository.findMembership(companyId, userId);
    if (!membership) throw new NotFoundException('User');

    const updated = await this.repository.updateMembership(
      membership.userCompanyId,
      dto,
      actorId,
    );
    const role = await this.repository.findPrimaryRole(userId, companyId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserCompany',
      entityId: membership.userCompanyId.toString(),
      newValue: dto as Record<string, unknown>,
    });

    return serialize(this.toUserPayload(updated, role?.role ?? null));
  }

  async setStatus(
    companyId: string,
    userId: string,
    dto: SetCompanyUserStatusDto,
    actorId: string,
  ) {
    const membership = await this.repository.findMembership(companyId, userId);
    if (!membership) throw new NotFoundException('User');

    const updated = await this.repository.updateMembershipStatus(
      membership.userCompanyId,
      dto.status,
      actorId,
    );
    const role = await this.repository.findPrimaryRole(userId, companyId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserCompany',
      entityId: membership.userCompanyId.toString(),
      newValue: { status: dto.status },
    });

    return serialize(this.toUserPayload(updated, role?.role ?? null));
  }

  async setModuleAccess(
    companyId: string,
    userId: string,
    dto: SetCompanyUserModuleAccessDto,
    actorId: string,
  ) {
    const membership = await this.repository.findMembership(companyId, userId);
    if (!membership) throw new NotFoundException('User');

    const rows = await this.repository.replaceModuleAccess(userId, companyId, dto.items, actorId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'UserModuleAccess',
      entityId: userId,
      newValue: { items: dto.items },
    });

    return serialize(
      rows.map((row) => ({
        moduleId: row.moduleId.toString(),
        moduleCode: row.module?.moduleCode ?? null,
        moduleName: row.module?.moduleName ?? null,
        accessType: row.accessType,
      })),
    );
  }

  async remove(companyId: string, userId: string, actorId: string) {
    const membership = await this.repository.findMembership(companyId, userId);
    if (!membership) throw new NotFoundException('User');

    await this.repository.removeFromCompany(userId, companyId, actorId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'UserCompany',
      entityId: membership.userCompanyId.toString(),
    });

    return { message: 'User removed from company' };
  }
}

function randomTempSuffix() {
  return randomBytes(3).toString('hex');
}
