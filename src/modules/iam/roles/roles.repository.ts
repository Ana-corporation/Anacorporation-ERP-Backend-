import { Injectable } from '@nestjs/common';
import { Prisma, RoleStatus } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CloneRoleDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import {
  RoleEndReason,
  createActiveUserRole,
  endActiveUserRoles,
} from './role-assignment.helpers';

const ROLES_LIST_FILTER: ListFilterOptions = {
  contains: { code: 'roleCode', name: 'roleName' },
  dateRange: { field: 'createdAt' },
  searchFields: ['roleCode', 'roleName', 'description'],
  sortFields: ['roleCode', 'roleName', 'createdAt', 'status'],
  defaultSortField: 'createdAt',
};

const USER_DISPLAY_SELECT = {
  userId: true,
  displayName: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
} as const;

@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const statusFilter = this.resolveStatusFilter(query.status);

    const where = buildListWhere(
      {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        ...statusFilter,
      },
      query,
      ROLES_LIST_FILTER,
    ) as Prisma.RoleWhereInput;

    const includeAssignees = query.includeAssigneeSummary === true;

    return this.prisma
      .$transaction([
        this.prisma.role.findMany({
          where,
          skip,
          take: limit,
          orderBy: resolveOrderBy(query, ROLES_LIST_FILTER),
          include: {
            rolePermissions: { include: { permission: true } },
            ...(includeAssignees
              ? {
                  userRoles: {
                    where: { isActive: true, user: { deletedAt: null } },
                    select: {
                      userRoleId: true,
                      userId: true,
                      assignedDate: true,
                      user: { select: USER_DISPLAY_SELECT },
                    },
                    orderBy: { assignedDate: 'asc' },
                  },
                }
              : {}),
            _count: {
              select: {
                userRoles: {
                  where: { isActive: true, user: { deletedAt: null } },
                },
              },
            },
          },
        }),
        this.prisma.role.count({ where }),
      ])
      .then(([items, total]) => ({ items, total, page, limit }));
  }

  /** Default ACTIVE for pickers; status=ALL returns every non-deleted status. */
  private resolveStatusFilter(status?: string): { status?: RoleStatus } {
    const raw = (status ?? 'ACTIVE').trim().toUpperCase();
    if (raw === 'ALL') return {};
    if (raw === 'INACTIVE') return { status: 'INACTIVE' };
    return { status: 'ACTIVE' };
  }

  findById(id: string, companyId: string) {
    return this.prisma.role.findFirst({
      where: {
        roleId: parseBigIntId(id),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      include: {
        rolePermissions: { include: { permission: true, module: true } },
        _count: {
          select: {
            userRoles: {
              where: { isActive: true, user: { deletedAt: null } },
            },
          },
        },
      },
    });
  }

  findByCode(companyId: string, roleCode: string) {
    return this.prisma.role.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        roleCode,
        deletedAt: null,
      },
    });
  }

  create(companyId: string, dto: CreateRoleDto & { roleCode: string }, createdBy?: string) {
    return this.prisma.role.create({
      data: {
        companyId: parseBigIntId(companyId),
        roleCode: dto.roleCode.trim().toUpperCase(),
        roleName: dto.roleName.trim(),
        description: dto.description,
        isSystem: false,
        roleType: 'CUSTOM',
        systemTemplateKey: null,
        status: 'ACTIVE',
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateRoleDto, updatedBy?: string) {
    return this.prisma.role.update({
      where: { roleId: parseBigIntId(id) },
      data: {
        ...(dto.roleName !== undefined ? { roleName: dto.roleName.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  setStatus(
    id: string,
    status: RoleStatus,
    actorId?: string,
  ) {
    const actor = actorId ? parseBigIntId(actorId) : undefined;
    return this.prisma.role.update({
      where: { roleId: parseBigIntId(id) },
      data:
        status === 'INACTIVE'
          ? {
              status: 'INACTIVE',
              deactivatedAt: new Date(),
              deactivatedBy: actor,
              updatedBy: actor,
              updatedAt: new Date(),
            }
          : {
              status: 'ACTIVE',
              deactivatedAt: null,
              deactivatedBy: null,
              updatedBy: actor,
              updatedAt: new Date(),
            },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.role.update({
      where: { roleId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        status: 'INACTIVE',
        deactivatedAt: new Date(),
        deactivatedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
      },
    });
  }

  async setPermissionsByCodes(roleId: string, permissionCodes: string[], actorId?: string) {
    const role = await this.prisma.role.findUnique({
      where: { roleId: parseBigIntId(roleId) },
    });
    if (!role) return { role: null, missingCodes: [] as string[] };

    const normalized = [
      ...new Set(permissionCodes.map((c) => c.trim()).filter((c) => c.length > 0)),
    ];

    const permissions =
      normalized.length === 0
        ? []
        : await this.prisma.permission.findMany({
            where: { permissionCode: { in: normalized } },
          });

    const found = new Set(permissions.map((p) => p.permissionCode));
    const missingCodes = normalized.filter((c) => !found.has(c));
    if (missingCodes.length > 0) {
      return { role: null, missingCodes };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.roleId } });
      if (permissions.length === 0) return;
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({
          roleId: role.roleId,
          moduleId: p.moduleId,
          permissionId: p.permissionId,
          isAllowed: true,
          createdBy: actorId ? parseBigIntId(actorId) : undefined,
        })),
      });
    });

    const updated = await this.findById(roleId, role.companyId!.toString());
    return { role: updated, missingCodes: [] as string[] };
  }

  async cloneRole(
    sourceRoleId: string,
    companyId: string,
    dto: CloneRoleDto & { roleCode: string },
    createdBy?: string,
  ) {
    const source = await this.findById(sourceRoleId, companyId);
    if (!source) return null;

    const newCode = dto.roleCode.trim().toUpperCase();
    const created = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          companyId: parseBigIntId(companyId),
          roleCode: newCode,
          roleName: dto.roleName.trim(),
          description: dto.description ?? source.description,
          isSystem: false,
          roleType: 'CUSTOM',
          systemTemplateKey: null,
          status: 'ACTIVE',
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
      });

      if (source.rolePermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: source.rolePermissions.map((rp) => ({
            roleId: role.roleId,
            moduleId: rp.moduleId,
            permissionId: rp.permissionId,
            isAllowed: rp.isAllowed,
            createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
          })),
        });
      }

      return role;
    });

    return this.findById(created.roleId.toString(), companyId);
  }

  findActiveUserIdsByRole(companyId: string, roleId: string) {
    return this.prisma.userRole.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
        isActive: true,
      },
      select: { userId: true },
    });
  }

  countActiveAssignees(companyId: string, roleId: string) {
    return this.prisma.userRole.count({
      where: {
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
        isActive: true,
        user: { deletedAt: null },
      },
    });
  }

  countAssignmentHistory(companyId: string, roleId: string) {
    return this.prisma.userRole.count({
      where: {
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
      },
    });
  }

  findAssignments(companyId: string, roleId: string, includeHistory: boolean) {
    return this.prisma.userRole.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
        ...(includeHistory ? {} : { isActive: true }),
        user: { deletedAt: null },
      },
      include: {
        user: { select: USER_DISPLAY_SELECT },
      },
      orderBy: [{ isActive: 'desc' }, { assignedDate: 'desc' }],
    });
  }

  findActiveAssignment(companyId: string, roleId: string, userId: string) {
    return this.prisma.userRole.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
        userId: parseBigIntId(userId),
        isActive: true,
      },
    });
  }

  findCompanyMembership(companyId: string, userId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        userId: parseBigIntId(userId),
        deletedAt: null,
        user: { deletedAt: null },
      },
    });
  }

  /**
   * History-preserving bulk move: end fromRole assignments, create new toRole periods.
   */
  async reassignActiveAssignees(
    companyId: string,
    fromRoleId: string,
    toRoleId: string,
    assignedBy?: string,
    endReason: RoleEndReason = 'ROLE_DELETED',
  ) {
    const companyIdBig = parseBigIntId(companyId);
    const fromRoleIdBig = parseBigIntId(fromRoleId);
    const toRoleIdBig = parseBigIntId(toRoleId);
    const assignedByBig = assignedBy ? parseBigIntId(assignedBy) : undefined;

    const assignees = await this.prisma.userRole.findMany({
      where: {
        companyId: companyIdBig,
        roleId: fromRoleIdBig,
        isActive: true,
        user: { deletedAt: null },
      },
      select: { userRoleId: true, userId: true },
    });

    if (assignees.length === 0) return 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of assignees) {
        await endActiveUserRoles(
          tx,
          { companyId: companyIdBig, userId: row.userId },
          { endedBy: assignedByBig, endReason },
        );
        await createActiveUserRole(
          tx,
          {
            userId: row.userId,
            companyId: companyIdBig,
            roleId: toRoleIdBig,
            assignedBy: assignedByBig,
          },
          endReason,
        );
      }
    });

    return assignees.length;
  }

  assignUserToRole(companyId: string, roleId: string, userId: string, actorId: string) {
    const companyIdBig = parseBigIntId(companyId);
    const roleIdBig = parseBigIntId(roleId);
    const userIdBig = parseBigIntId(userId);
    const actorBig = parseBigIntId(actorId);

    return this.prisma.$transaction(async (tx) =>
      createActiveUserRole(tx, {
        userId: userIdBig,
        companyId: companyIdBig,
        roleId: roleIdBig,
        assignedBy: actorBig,
      }),
    );
  }

  unassignUserFromRole(
    companyId: string,
    roleId: string,
    userId: string,
    actorId: string,
  ) {
    const companyIdBig = parseBigIntId(companyId);
    const roleIdBig = parseBigIntId(roleId);
    const userIdBig = parseBigIntId(userId);
    const actorBig = parseBigIntId(actorId);

    return this.prisma.$transaction(async (tx) =>
      endActiveUserRoles(
        tx,
        { companyId: companyIdBig, roleId: roleIdBig, userId: userIdBig },
        { endedBy: actorBig, endReason: 'UNASSIGNED' },
      ),
    );
  }

  reassignRoleHolder(
    companyId: string,
    roleId: string,
    fromUserId: string,
    toUserId: string,
    actorId: string,
  ) {
    const companyIdBig = parseBigIntId(companyId);
    const roleIdBig = parseBigIntId(roleId);
    const fromUserIdBig = parseBigIntId(fromUserId);
    const toUserIdBig = parseBigIntId(toUserId);
    const actorBig = parseBigIntId(actorId);

    return this.prisma.$transaction(async (tx) => {
      await endActiveUserRoles(
        tx,
        { companyId: companyIdBig, roleId: roleIdBig, userId: fromUserIdBig },
        { endedBy: actorBig, endReason: 'REASSIGNED' },
      );
      return createActiveUserRole(tx, {
        userId: toUserIdBig,
        companyId: companyIdBig,
        roleId: roleIdBig,
        assignedBy: actorBig,
      });
    });
  }
}
