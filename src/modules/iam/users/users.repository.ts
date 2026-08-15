import { Injectable } from '@nestjs/common';
import { MembershipStatus, ModuleAccessType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { buildListWhere, resolveOrderBy, ListFilterOptions } from '@/common/utils/prisma-filter.util';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const USERS_LIST_FILTER: ListFilterOptions = {
  contains: { email: 'email', name: 'username' },
  booleans: { isActive: 'isActive' },
  dateRange: { field: 'createdAt' },
  searchFields: ['email', 'username', 'firstName', 'lastName', 'displayName'],
  sortFields: ['email', 'username', 'firstName', 'lastName', 'createdAt'],
  defaultSortField: 'createdAt',
};

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByCompany(companyId: string, query: PaginationQueryDto) {
    const { skip, limit, page } = getPaginationParams(query);
    const cid = parseBigIntId(companyId);
    const where = buildListWhere(
      {
        deletedAt: null,
        companies: { some: { companyId: cid, deletedAt: null } },
      },
      query,
      USERS_LIST_FILTER,
    ) as Prisma.UserWhereInput;

    return this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: resolveOrderBy(query, USERS_LIST_FILTER),
        include: {
          companies: {
            where: { companyId: cid, deletedAt: null },
            take: 1,
          },
          roles: {
            where: { companyId: cid, isActive: true },
            include: { role: true },
            take: 1,
            orderBy: { assignedDate: 'desc' },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findById(id: string) {
    return this.prisma.user.findFirst({
      where: { userId: parseBigIntId(id), deletedAt: null },
      include: {
        companies: { where: { deletedAt: null }, include: { company: true } },
        roles: { where: { isActive: true }, include: { role: true } },
      },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });
  }

  findByUsername(username: string) {
    return this.prisma.user.findFirst({
      where: { username, deletedAt: null },
    });
  }

  findMembership(userId: string, companyId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  findCompanyRole(companyId: string, roleId: string) {
    return this.prisma.role.findFirst({
      where: {
        roleId: parseBigIntId(roleId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
    });
  }

  /**
   * Company-scoped user snapshot for invite/list responses.
   */
  findCompanyUserDetail(userId: string, companyId: string) {
    return this.prisma.user.findFirst({
      where: {
        userId: parseBigIntId(userId),
        deletedAt: null,
        companies: {
          some: { companyId: parseBigIntId(companyId), deletedAt: null },
        },
      },
      include: {
        companies: {
          where: { companyId: parseBigIntId(companyId), deletedAt: null },
          take: 1,
        },
        roles: {
          where: {
            companyId: parseBigIntId(companyId),
            isActive: true,
          },
          include: { role: true },
          take: 1,
          orderBy: { assignedDate: 'desc' },
        },
      },
    });
  }

  create(dto: CreateUserDto, companyId: string, passwordHash: string, createdBy?: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username.trim(),
          email: dto.email.trim().toLowerCase(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          mobile: dto.mobile,
          displayName: [dto.firstName, dto.lastName].filter(Boolean).join(' ') || dto.username,
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
      });

      await tx.userAuthentication.create({
        data: { userId: user.userId, passwordHash, mustChangePassword: true },
      });

      await tx.userCompany.create({
        data: {
          userId: user.userId,
          companyId: parseBigIntId(companyId),
          status: 'active',
          createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
        },
      });

      return user;
    });
  }

  createInvitedUser(params: {
    companyId: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    mobile?: string | null;
    employeeId?: string | null;
    passwordHash: string;
    passwordExpiresDate: Date;
    createdBy?: string;
  }) {
    const displayName =
      [params.firstName, params.lastName].filter(Boolean).join(' ').trim() || params.username;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: params.username,
          email: params.email.trim().toLowerCase(),
          firstName: params.firstName,
          lastName: params.lastName || null,
          mobile: params.mobile || null,
          displayName,
          createdBy: params.createdBy ? parseBigIntId(params.createdBy) : undefined,
        },
      });

      await tx.userAuthentication.create({
        data: {
          userId: user.userId,
          passwordHash: params.passwordHash,
          mustChangePassword: true,
          passwordExpiresDate: params.passwordExpiresDate,
          lastPasswordReset: new Date(),
        },
      });

      // active so temp password can be used for first login (mustChangePassword=true)
      const membership = await tx.userCompany.create({
        data: {
          userId: user.userId,
          companyId: parseBigIntId(params.companyId),
          employeeId: params.employeeId || null,
          status: 'active',
          isDefault: true,
          createdBy: params.createdBy ? parseBigIntId(params.createdBy) : undefined,
        },
      });

      return { user, membership };
    });
  }

  attachMembership(params: {
    userId: string;
    companyId: string;
    employeeId?: string | null;
    createdBy?: string;
  }) {
    return this.prisma.userCompany.create({
      data: {
        userId: parseBigIntId(params.userId),
        companyId: parseBigIntId(params.companyId),
        employeeId: params.employeeId || null,
        status: 'active',
        isDefault: false,
        createdBy: params.createdBy ? parseBigIntId(params.createdBy) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateUserDto, updatedBy?: string, displayName?: string) {
    return this.prisma.user.update({
      where: { userId: parseBigIntId(id) },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
        ...(dto.timeZone !== undefined ? { timeZone: dto.timeZone } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  softDelete(id: string, deletedBy?: string) {
    return this.prisma.user.update({
      where: { userId: parseBigIntId(id) },
      data: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? parseBigIntId(deletedBy) : undefined,
        isActive: false,
      },
    });
  }

  assignRole(userId: string, companyId: string, roleId: string, assignedBy?: string) {
    return this.replacePrimaryRole(userId, companyId, roleId, assignedBy);
  }

  /**
   * Replace the single active role for a user in a company.
   * roleId=null deactivates all roles.
   */
  replacePrimaryRole(
    userId: string,
    companyId: string,
    roleId: string | null,
    assignedBy?: string,
  ) {
    const uid = parseBigIntId(userId);
    const cid = parseBigIntId(companyId);
    const nextRoleId = roleId ? parseBigIntId(roleId) : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.userRole.updateMany({
        where: {
          userId: uid,
          companyId: cid,
          ...(nextRoleId ? { roleId: { not: nextRoleId } } : {}),
        },
        data: { isActive: false },
      });

      if (!nextRoleId) return null;

      return tx.userRole.upsert({
        where: {
          userId_companyId_roleId: {
            userId: uid,
            companyId: cid,
            roleId: nextRoleId,
          },
        },
        update: {
          isActive: true,
          assignedBy: assignedBy ? parseBigIntId(assignedBy) : undefined,
          assignedDate: new Date(),
        },
        create: {
          userId: uid,
          companyId: cid,
          roleId: nextRoleId,
          assignedBy: assignedBy ? parseBigIntId(assignedBy) : undefined,
          isActive: true,
        },
        include: { role: true },
      });
    });
  }

  findCompanyOrgRef(
    kind: 'department' | 'designation' | 'branch' | 'warehouse',
    id: string,
    companyId: string,
  ) {
    const cid = parseBigIntId(companyId);
    const parsedId = parseBigIntId(id);
    const scope = { companyId: cid, deletedAt: null };

    if (kind === 'department') {
      return this.prisma.department.findFirst({
        where: { departmentId: parsedId, ...scope },
        select: { departmentId: true },
      });
    }
    if (kind === 'designation') {
      return this.prisma.designation.findFirst({
        where: { designationId: parsedId, ...scope },
        select: { designationId: true },
      });
    }
    if (kind === 'branch') {
      return this.prisma.branch.findFirst({
        where: { branchId: parsedId, ...scope },
        select: { branchId: true },
      });
    }
    return this.prisma.warehouse.findFirst({
      where: { warehouseId: parsedId, ...scope },
      select: { warehouseId: true },
    });
  }

  updateMembership(
    userId: string,
    companyId: string,
    data: {
      employeeId?: string | null;
      departmentId?: string | null;
      designationId?: string | null;
      branchId?: string | null;
      warehouseId?: string | null;
      status?: MembershipStatus;
    },
    updatedBy?: string,
  ) {
    return this.prisma.userCompany.updateMany({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      data: {
        ...(data.employeeId !== undefined ? { employeeId: data.employeeId } : {}),
        ...(data.departmentId !== undefined
          ? { departmentId: data.departmentId ? parseBigIntId(data.departmentId) : null }
          : {}),
        ...(data.designationId !== undefined
          ? { designationId: data.designationId ? parseBigIntId(data.designationId) : null }
          : {}),
        ...(data.branchId !== undefined
          ? { branchId: data.branchId ? parseBigIntId(data.branchId) : null }
          : {}),
        ...(data.warehouseId !== undefined
          ? { warehouseId: data.warehouseId ? parseBigIntId(data.warehouseId) : null }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        updatedBy: updatedBy ? parseBigIntId(updatedBy) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  findModulesByIds(moduleIds: string[]) {
    const ids = moduleIds.map((id) => parseBigIntId(id));
    return this.prisma.module.findMany({
      where: { moduleId: { in: ids }, deletedAt: null },
      select: { moduleId: true },
    });
  }

  /**
   * Replace user_module_access overrides for a company user.
   * items = full override set; omitted modules inherit the role default.
   */
  replaceModuleAccess(
    userId: string,
    companyId: string,
    items: Array<{ moduleId: string; accessType: ModuleAccessType }>,
    createdBy?: string,
  ) {
    const uid = parseBigIntId(userId);
    const cid = parseBigIntId(companyId);
    const byModule = new Map<string, ModuleAccessType>();
    for (const item of items) {
      byModule.set(item.moduleId, item.accessType);
    }
    const keepIds = [...byModule.keys()].map((id) => parseBigIntId(id));

    return this.prisma.$transaction(async (tx) => {
      if (keepIds.length === 0) {
        await tx.userModuleAccess.deleteMany({
          where: { userId: uid, companyId: cid },
        });
        return [];
      }

      await tx.userModuleAccess.deleteMany({
        where: {
          userId: uid,
          companyId: cid,
          moduleId: { notIn: keepIds },
        },
      });

      const saved = [];
      for (const [moduleId, accessType] of byModule) {
        const mid = parseBigIntId(moduleId);
        saved.push(
          await tx.userModuleAccess.upsert({
            where: {
              userId_companyId_moduleId: {
                userId: uid,
                companyId: cid,
                moduleId: mid,
              },
            },
            update: { accessType, rowVersion: { increment: 1 } },
            create: {
              userId: uid,
              companyId: cid,
              moduleId: mid,
              accessType,
              createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
            },
            select: {
              userModuleAccessId: true,
              moduleId: true,
              accessType: true,
            },
          }),
        );
      }
      return saved;
    });
  }

  findActiveAdminRole(userId: string, companyId: string) {
    const cid = parseBigIntId(companyId);
    return this.prisma.userRole.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: cid,
        isActive: true,
        role: { roleCode: 'ADMIN', deletedAt: null },
      },
      include: { role: true },
    });
  }

  countOtherActiveAdmins(companyId: string, excludeUserId: string) {
    const cid = parseBigIntId(companyId);
    return this.prisma.userRole.count({
      where: {
        companyId: cid,
        isActive: true,
        userId: { not: parseBigIntId(excludeUserId) },
        role: { roleCode: 'ADMIN', deletedAt: null },
        user: {
          deletedAt: null,
          companies: {
            some: {
              companyId: cid,
              deletedAt: null,
              status: MembershipStatus.active,
            },
          },
        },
      },
    });
  }
}
