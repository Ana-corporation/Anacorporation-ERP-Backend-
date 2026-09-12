import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
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
import {
  AssignRolePersonDto,
  CloneRoleDto,
  CreateRoleDto,
  DeactivateRoleDto,
  DeleteRoleDto,
  ReassignRolePersonDto,
  SetRolePermissionsDto,
  UnassignRolePersonDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RolesRepository } from './roles.repository';
import { ROLE_ERROR_CODES, isSystemRole } from './role.constants';
import {
  allocateUniqueRoleCode,
  isReservedRoleCode,
  normalizeRoleCodeBase,
} from './role-code.util';

function displayName(user: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
}) {
  return (
    user.displayName?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    user.username ||
    user.email ||
    null
  );
}

@Injectable()
export class RolesService {
  constructor(
    private readonly repository: RolesRepository,
    private readonly auditService: AuditService,
    private readonly userContextCache: UserContextCacheService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto) {
    const { items, total, page, limit } = await this.repository.findManyByCompany(
      companyId,
      query,
    );
    const mapped = await this.auditService.withAuditList(
      items.map((role) => serialize(this.mapRoleRow(role as any)) as Record<string, unknown>),
    );
    return toPaginatedResult(mapped, total, page, limit);
  }

  async findOne(id: string, companyId: string) {
    const role = await this.repository.findById(id, companyId);
    if (!role) throw new NotFoundException('Role');
    return this.presentRole(role);
  }

  async create(companyId: string, dto: CreateRoleDto, actorId: string) {
    const roleCode = await this.resolveRoleCodeForCreate(companyId, {
      roleCode: dto.roleCode,
      roleName: dto.roleName,
    });

    const role = await this.repository.create(
      companyId,
      { ...dto, roleCode },
      actorId,
    );

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Role',
      entityId: role.roleId.toString(),
      newValue: { roleCode, roleName: role.roleName, roleType: 'CUSTOM' },
    });

    return this.presentRole(role);
  }

  async getPermissions(id: string, companyId: string) {
    const role = await this.repository.findById(id, companyId);
    if (!role) throw new NotFoundException('Role');
    const permissions = (role.rolePermissions ?? [])
      .filter((rp: { isAllowed: boolean }) => rp.isAllowed)
      .map((rp: {
        permissionId: bigint;
        moduleId: bigint;
        isAllowed: boolean;
        permission?: { permissionCode?: string; action?: string };
      }) => ({
        permissionId: rp.permissionId.toString(),
        permissionCode: rp.permission?.permissionCode ?? null,
        moduleId: rp.moduleId.toString(),
        action: rp.permission?.action ?? null,
        isAllowed: rp.isAllowed,
      }));
    return serialize({ roleId: id, permissions });
  }

  async update(id: string, companyId: string, dto: UpdateRoleDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Role');

    if (isSystemRole(existing) && dto.roleName !== undefined) {
      const nextName = dto.roleName.trim();
      if (nextName !== existing.roleName) {
        throw new ConflictException(
          'System roles cannot be renamed',
          ROLE_ERROR_CODES.SYSTEM_ROLE_RENAME_BLOCKED,
        );
      }
    }

    const role = await this.repository.update(id, dto, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Role',
      entityId: id,
      newValue: dto as Record<string, unknown>,
    });

    const fresh = await this.repository.findById(id, companyId);
    return this.presentRole(fresh ?? role);
  }

  async remove(id: string, companyId: string, actorId: string, dto?: DeleteRoleDto) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Role');
    if (isSystemRole(existing)) throw new ConflictException(
      'System roles cannot be deleted',
      ROLE_ERROR_CODES.SYSTEM_ROLE_DELETE_BLOCKED,
    );

    const assignedCount = await this.repository.countActiveAssignees(companyId, id);
    const reassignToRoleId = dto?.reassignToRoleId?.trim();

    if (assignedCount > 0) {
      if (!reassignToRoleId) {
        throw new ConflictException(
          'This role has active users assigned. Reassign or unassign all active users before deleting the role.',
          ROLE_ERROR_CODES.ROLE_HAS_ACTIVE_ASSIGNEES,
        );
      }

      if (reassignToRoleId === id) {
        throw new BusinessException('reassignToRoleId must be a different role');
      }

      const target = await this.repository.findById(reassignToRoleId, companyId);
      if (!target) throw new NotFoundException('Reassign target role');
      if (target.status !== 'ACTIVE') {
        throw new ConflictException('Cannot reassign users to an INACTIVE role');
      }

      const affectedUserIds = await this.repository.findActiveUserIdsByRole(companyId, id);
      const moved = await this.repository.reassignActiveAssignees(
        companyId,
        id,
        reassignToRoleId,
        actorId,
        'ROLE_DELETED',
      );

      await Promise.all(
        affectedUserIds.map((row) =>
          this.userContextCache.invalidate(row.userId.toString(), companyId),
        ),
      );

      await this.repository.softDelete(id, actorId);

      await this.auditService.log({
        companyId,
        performedBy: actorId,
        action: UserAuditAction.delete,
        entityName: 'Role',
        entityId: id,
        newValue: { reassignToRoleId, reassignedUsers: moved },
      });

      return { message: 'Role deleted', reassignedUsers: moved, reassignToRoleId };
    }

    // Soft-delete allowed with ENDED history rows (ACTIVE assignees already cleared).
    await this.repository.softDelete(id, actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.delete,
      entityName: 'Role',
      entityId: id,
    });

    return { message: 'Role deleted' };
  }

  async setPermissions(id: string, companyId: string, dto: SetRolePermissionsDto, actorId: string) {
    const existing = await this.repository.findById(id, companyId);
    if (!existing) throw new NotFoundException('Role');

    if (isSystemRole(existing)) {
      throw new ConflictException(
        'System role permissions are product-defined and locked. Clone the role to a custom role, then edit permissions.',
        ROLE_ERROR_CODES.SYSTEM_ROLE_PERMISSIONS_LOCKED,
      );
    }

    let permissionCodes = [...(dto.permissionCodes ?? [])];
    if (permissionCodes.length === 0 && dto.permissions?.length) {
      const rows = await this.repository.findPermissionsByModuleActions(dto.permissions);
      permissionCodes = rows.map((p) => p.permissionCode);
    }

    const { role, missingCodes } = await this.repository.setPermissionsByCodes(
      id,
      permissionCodes,
      actorId,
    );

    if (missingCodes.length > 0) {
      throw new BusinessException(`Unknown permission codes: ${missingCodes.join(', ')}`);
    }
    if (!role) throw new NotFoundException('Role');

    await this.invalidateRoleAssigneeCaches(companyId, id);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'RolePermission',
      entityId: id,
      newValue: { permissionCodes: dto.permissionCodes ?? [] },
    });

    return this.presentRole(role);
  }

  async clone(id: string, companyId: string, dto: CloneRoleDto, actorId: string) {
    const source = await this.repository.findById(id, companyId);
    if (!source) throw new NotFoundException('Role');

    const roleCode = await this.resolveRoleCodeForCreate(companyId, {
      roleCode: dto.roleCode,
      roleName: dto.roleName,
      fallbackFromCode: source.roleCode,
    });

    const cloned = await this.repository.cloneRole(
      id,
      companyId,
      { ...dto, roleCode },
      actorId,
    );
    if (!cloned) throw new NotFoundException('Role');

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.create,
      entityName: 'Role',
      entityId: cloned.roleId.toString(),
      newValue: {
        clonedFromRoleId: id,
        roleCode: cloned.roleCode,
        roleName: cloned.roleName,
        isSystem: false,
        roleType: 'CUSTOM',
        systemTemplateKey: null,
        action: 'CLONE',
      },
    });

    return this.presentRole(cloned);
  }

  /**
   * Explicit roleCode ΓåÆ normalize + reserved/duplicate checks.
   * Omitted/blank ΓåÆ auto from roleName (or source code on clone) + uniqueness suffix.
   */
  private async resolveRoleCodeForCreate(
    companyId: string,
    params: { roleCode?: string; roleName: string; fallbackFromCode?: string },
  ): Promise<string> {
    const isTaken = async (code: string) =>
      Boolean(await this.repository.findByCode(companyId, code));

    if (params.roleCode) {
      const code = normalizeRoleCodeBase(params.roleCode);
      if (isReservedRoleCode(code)) {
        throw new BusinessException(
          `Role code ${code} is reserved`,
          HttpStatus.BAD_REQUEST,
          undefined,
          ROLE_ERROR_CODES.ROLE_CODE_RESERVED,
        );
      }
      if (await isTaken(code)) {
        throw new ConflictException(
          'Role code already exists in this company',
          ROLE_ERROR_CODES.ROLE_CODE_EXISTS,
        );
      }
      return code;
    }

    const preferredBase = normalizeRoleCodeBase(params.roleName || params.fallbackFromCode || 'ROLE');
    // Avoid landing on reserved codes without a suffix when auto-generating.
    let base = preferredBase;
    if (isReservedRoleCode(base)) {
      base = `${base}_CUSTOM`.slice(0, 40);
    }

    return allocateUniqueRoleCode({
      preferredBase: base,
      isTaken: async (code) => isReservedRoleCode(code) || (await isTaken(code)),
    });
  }

  /**
   * Deactivate (retire) role for this company ΓÇö SYSTEM and CUSTOM allowed.
   * Rule A: zero ACTIVE assignees required. Does not auto-unassign.
   */
  async deactivate(
    id: string,
    companyId: string,
    actorId: string,
    dto?: DeactivateRoleDto,
  ) {
    const role = await this.repository.findById(id, companyId);
    if (!role) throw new NotFoundException('Role');
    if (role.status === 'INACTIVE') {
      return this.presentRole(role);
    }

    const assignedCount = await this.repository.countActiveAssignees(companyId, id);
    if (assignedCount > 0) {
      throw new ConflictException(
        'This role has active users assigned. Reassign or unassign all active users before deactivating the role.',
        ROLE_ERROR_CODES.ROLE_HAS_ACTIVE_ASSIGNEES,
      );
    }

    const updated = await this.repository.setStatus(id, 'INACTIVE', actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Role',
      entityId: id,
      newValue: {
        status: 'INACTIVE',
        roleType: role.roleType,
        isSystem: role.isSystem,
        reason: dto?.reason ?? null,
        action: 'DEACTIVATE',
      },
    });

    return this.presentRole(updated);
  }

  async reactivate(id: string, companyId: string, actorId: string) {
    const role = await this.repository.findById(id, companyId);
    if (!role) throw new NotFoundException('Role');
    if (role.status === 'ACTIVE') {
      return this.presentRole(role);
    }

    const updated = await this.repository.setStatus(id, 'ACTIVE', actorId);

    await this.auditService.log({
      companyId,
      performedBy: actorId,
      action: UserAuditAction.update,
      entityName: 'Role',
      entityId: id,
      newValue: {
        status: 'ACTIVE',
        roleType: role.roleType,
        isSystem: role.isSystem,
        action: 'REACTIVATE',
      },
    });

    return this.presentRole(updated);
  }

  async assignPerson(
    roleId: string,
    companyId: string,
    dto: AssignRolePersonDto,
    actorId: string,
  ) {
    const role = await this.requireAssignableRole(roleId, companyId);
    await this.requireCompanyMember(companyId, dto.userId);

    const existing = await this.repository.findActiveAssignment(
      companyId,
      roleId,
      dto.userId,
    );
    if (existing) {
      throw new ConflictException(
        'User is already actively assigned to this role',
        ROLE_ERROR_CODES.DUPLICATE_ASSIGNMENT,
      );
    }

    const assignment = await this.repository.assignUserToRole(
      companyId,
      role.roleId.toString(),
      dto.userId,
      actorId,
    );

    await this.userContextCache.invalidate(dto.userId, companyId);

    await this.auditService.log({
      companyId,
      userId: dto.userId,
      performedBy: actorId,
      action: UserAuditAction.role_change,
      entityName: 'UserRole',
      entityId: assignment.userRoleId.toString(),
      newValue: { roleId, userId: dto.userId, action: 'ASSIGN' },
    });

    return serialize(this.mapAssignment(assignment));
  }

  async reassignPerson(
    roleId: string,
    companyId: string,
    dto: ReassignRolePersonDto,
    actorId: string,
  ) {
    await this.requireAssignableRole(roleId, companyId);
    await this.requireCompanyMember(companyId, dto.toUserId);

    let fromUserId = dto.fromUserId;
    if (!fromUserId) {
      const active = await this.repository.findAssignments(companyId, roleId, false);
      if (active.length === 0) {
        throw new ConflictException('Role has no active assignee to reassign from');
      }
      if (active.length > 1) {
        throw new BusinessException(
          'Role has multiple active assignees; fromUserId is required',
        );
      }
      fromUserId = active[0].userId.toString();
    }

    if (fromUserId === dto.toUserId) {
      throw new BusinessException('fromUserId and toUserId must differ');
    }

    const fromAssignment = await this.repository.findActiveAssignment(
      companyId,
      roleId,
      fromUserId,
    );
    if (!fromAssignment) {
      throw new ConflictException('fromUserId is not an active assignee of this role');
    }

    await this.requireCompanyMember(companyId, fromUserId);

    const toExisting = await this.repository.findActiveAssignment(
      companyId,
      roleId,
      dto.toUserId,
    );
    if (toExisting) {
      throw new ConflictException('toUserId is already actively assigned to this role');
    }

    const assignment = await this.repository.reassignRoleHolder(
      companyId,
      roleId,
      fromUserId,
      dto.toUserId,
      actorId,
    );

    await Promise.all([
      this.userContextCache.invalidate(fromUserId, companyId),
      this.userContextCache.invalidate(dto.toUserId, companyId),
    ]);

    await this.auditService.log({
      companyId,
      userId: dto.toUserId,
      performedBy: actorId,
      action: UserAuditAction.role_change,
      entityName: 'UserRole',
      entityId: assignment.userRoleId.toString(),
      newValue: {
        roleId,
        fromUserId,
        toUserId: dto.toUserId,
        endReason: 'REASSIGNED',
        action: 'REASSIGN',
      },
    });

    return serialize(this.mapAssignment(assignment));
  }

  async unassignPerson(
    roleId: string,
    companyId: string,
    dto: UnassignRolePersonDto,
    actorId: string,
  ) {
    const role = await this.repository.findById(roleId, companyId);
    if (!role) throw new NotFoundException('Role');

    let userId = dto.userId;
    if (!userId) {
      const active = await this.repository.findAssignments(companyId, roleId, false);
      if (active.length === 0) {
        throw new ConflictException('Role has no active assignee to unassign');
      }
      if (active.length > 1) {
        throw new BusinessException(
          'Role has multiple active assignees; userId is required',
        );
      }
      userId = active[0].userId.toString();
    }

    const existing = await this.repository.findActiveAssignment(companyId, roleId, userId);
    if (!existing) {
      throw new ConflictException('User is not an active assignee of this role');
    }

    await this.repository.unassignUserFromRole(companyId, roleId, userId, actorId);
    await this.userContextCache.invalidate(userId, companyId);

    await this.auditService.log({
      companyId,
      userId,
      performedBy: actorId,
      action: UserAuditAction.role_change,
      entityName: 'UserRole',
      entityId: existing.userRoleId.toString(),
      newValue: {
        roleId,
        userId,
        endReason: 'UNASSIGNED',
        action: 'UNASSIGN',
      },
    });

    return {
      message: 'Assignment ended',
      roleId,
      userId,
      roleStatus: role.status,
    };
  }

  async listAssignments(
    roleId: string,
    companyId: string,
    history = false,
  ) {
    const role = await this.repository.findById(roleId, companyId);
    if (!role) throw new NotFoundException('Role');

    const rows = await this.repository.findAssignments(companyId, roleId, history);
    return serialize(rows.map((row) => this.mapAssignment(row)));
  }

  private async requireAssignableRole(roleId: string, companyId: string) {
    const role = await this.repository.findById(roleId, companyId);
    if (!role) throw new NotFoundException('Role');
    if (role.status !== 'ACTIVE') {
      throw new ConflictException(
        'Cannot assign users to an INACTIVE role',
        ROLE_ERROR_CODES.ROLE_INACTIVE,
      );
    }
    return role;
  }

  private async requireCompanyMember(companyId: string, userId: string) {
    const membership = await this.repository.findCompanyMembership(companyId, userId);
    if (!membership) {
      throw new BusinessException('User must be a member of this company');
    }
  }

  private presentRole(role: any) {
    return this.auditService.withAudit(
      serialize(this.mapRoleRow(role)) as Record<string, unknown>,
    );
  }

  private mapRoleRow(role: any) {
    const { _count, userRoles, ...rest } = role;
    const roleType =
      rest.roleType ?? (rest.isSystem ? 'SYSTEM' : 'CUSTOM');
    return {
      ...rest,
      isSystem: Boolean(rest.isSystem),
      roleType,
      systemTemplateKey:
        roleType === 'SYSTEM' ? (rest.systemTemplateKey ?? null) : null,
      assigneeCount: _count?.userRoles ?? (userRoles?.length ?? 0),
      ...(Array.isArray(userRoles)
        ? {
            assignees: userRoles.map((a: any) => ({
              userRoleId: a.userRoleId,
              userId: a.userId,
              displayName: a.user ? displayName(a.user) : null,
              assignedDate: a.assignedDate,
            })),
          }
        : {}),
    };
  }

  private mapAssignment(row: {
    userRoleId: bigint;
    userId: bigint;
    roleId: bigint;
    companyId: bigint;
    isActive: boolean;
    assignedDate: Date;
    assignedBy: bigint | null;
    endedAt?: Date | null;
    endedBy?: bigint | null;
    endReason?: string | null;
    user?: {
      userId: bigint;
      displayName: string | null;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      username: string | null;
    };
  }) {
    return {
      userRoleId: row.userRoleId,
      userId: row.userId,
      roleId: row.roleId,
      companyId: row.companyId,
      status: row.isActive ? 'ACTIVE' : 'ENDED',
      assignedDate: row.assignedDate,
      assignedBy: row.assignedBy,
      endedAt: row.endedAt ?? null,
      endedBy: row.endedBy ?? null,
      endReason: row.endReason ?? null,
      displayName: row.user ? displayName(row.user) : null,
    };
  }

  private async invalidateRoleAssigneeCaches(companyId: string, roleId: string) {
    const assignees = await this.repository.findActiveUserIdsByRole(companyId, roleId);
    await Promise.all(
      assignees.map((row) =>
        this.userContextCache.invalidate(row.userId.toString(), companyId),
      ),
    );
  }
}
