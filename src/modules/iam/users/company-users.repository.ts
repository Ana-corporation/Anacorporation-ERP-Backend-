import { Injectable } from '@nestjs/common';
import { ModuleAccessType, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PaginationQueryDto, getPaginationParams } from '@/common/dto/pagination.dto';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { createActiveUserRole } from '@/modules/iam/roles/role-assignment.helpers';

@Injectable()
export class CompanyUsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMemberships(companyId: string, query: PaginationQueryDto & { status?: string; roleId?: string }) {
    const { skip, limit, page } = getPaginationParams(query);
    const where: Prisma.UserCompanyWhereInput = {
      companyId: parseBigIntId(companyId),
      deletedAt: null,
    };

    if (query.status === 'active' || query.status === 'suspended' || query.status === 'invited') {
      where.status = query.status;
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.user = {
        deletedAt: null,
        OR: [
          { email: { contains: term, mode: 'insensitive' } },
          { username: { contains: term, mode: 'insensitive' } },
          { displayName: { contains: term, mode: 'insensitive' } },
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
        ],
      };
    }

    if (query.roleId) {
      where.user = {
        ...(where.user as Prisma.UserWhereInput),
        roles: {
          some: {
            companyId: parseBigIntId(companyId),
            roleId: parseBigIntId(query.roleId),
            isActive: true,
          },
        },
      };
    }

    return this.prisma.$transaction([
      this.prisma.userCompany.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: true,
        },
      }),
      this.prisma.userCompany.count({ where }),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }

  findMembership(companyId: string, userId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        userId: parseBigIntId(userId),
        deletedAt: null,
      },
      include: { user: true },
    });
  }

  findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });
  }

  findPrimaryRole(userId: string, companyId: string) {
    return this.prisma.userRole.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        isActive: true,
      },
      orderBy: { assignedDate: 'asc' },
      include: { role: true },
    });
  }

  findRolesForUsers(companyId: string, userIds: bigint[]) {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.prisma.userRole.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        userId: { in: userIds },
        isActive: true,
      },
      include: { role: true },
      orderBy: { assignedDate: 'asc' },
    });
  }

  findRole(companyId: string, roleId: string) {
    return this.prisma.role.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
        deletedAt: null,
      },
    });
  }

  async nextEmployeeId(companyId: string) {
    const count = await this.prisma.userCompany.count({
      where: { companyId: parseBigIntId(companyId) },
    });
    return `EMP-${String(count + 1).padStart(5, '0')}`;
  }

  async createUserWithMembership(params: {
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    mobile?: string;
    passwordHash: string;
    companyId: string;
    employeeId: string;
    roleId?: string;
    actorId?: string;
  }) {
    const actor = params.actorId ? parseBigIntId(params.actorId) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: params.email,
          username: params.username,
          firstName: params.firstName,
          lastName: params.lastName,
          mobile: params.mobile,
          displayName: `${params.firstName} ${params.lastName}`.trim(),
          createdBy: actor,
        },
      });

      await tx.userAuthentication.create({
        data: {
          userId: user.userId,
          passwordHash: params.passwordHash,
          mustChangePassword: true,
          isEmailVerified: false,
        },
      });

      const membership = await tx.userCompany.create({
        data: {
          userId: user.userId,
          companyId: parseBigIntId(params.companyId),
          employeeId: params.employeeId,
          status: 'active',
          isDefault: true,
          createdBy: actor,
        },
      });

      if (params.roleId) {
        await tx.userRole.create({
          data: {
            userId: user.userId,
            companyId: parseBigIntId(params.companyId),
            roleId: parseBigIntId(params.roleId),
            isActive: true,
            assignedBy: actor,
          },
        });
      }

      return { user, membership };
    });
  }

  async attachExistingUser(params: {
    userId: string;
    companyId: string;
    employeeId: string;
    roleId?: string;
    actorId?: string;
  }) {
    const actor = params.actorId ? parseBigIntId(params.actorId) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.userCompany.findFirst({
        where: {
          userId: parseBigIntId(params.userId),
          companyId: parseBigIntId(params.companyId),
        },
      });

      let membership;
      if (existing) {
        membership = await tx.userCompany.update({
          where: { userCompanyId: existing.userCompanyId },
          data: {
            deletedAt: null,
            deletedBy: null,
            status: 'active',
            employeeId: params.employeeId,
            updatedBy: actor,
            updatedAt: new Date(),
          },
        });
      } else {
        membership = await tx.userCompany.create({
          data: {
            userId: parseBigIntId(params.userId),
            companyId: parseBigIntId(params.companyId),
            employeeId: params.employeeId,
            status: 'active',
            isDefault: false,
            createdBy: actor,
          },
        });
      }

      if (params.roleId) {
        await createActiveUserRole(tx, {
          userId: parseBigIntId(params.userId),
          companyId: parseBigIntId(params.companyId),
          roleId: parseBigIntId(params.roleId),
          assignedBy: actor,
        });
      }

      return membership;
    });
  }

  updateProfile(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      displayName?: string;
      mobile?: string | null;
    },
    actorId?: string,
  ) {
    return this.prisma.user.update({
      where: { userId: parseBigIntId(userId) },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.mobile !== undefined ? { mobile: data.mobile } : {}),
        updatedBy: actorId ? parseBigIntId(actorId) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  async replaceRole(userId: string, companyId: string, roleId: string, actorId?: string) {
    const actor = actorId ? parseBigIntId(actorId) : undefined;
    return this.prisma.$transaction((tx) =>
      createActiveUserRole(tx, {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        roleId: parseBigIntId(roleId),
        assignedBy: actor,
      }),
    );
  }

  updateMembership(
    userCompanyId: bigint,
    data: {
      employeeId?: string | null;
      departmentId?: string | null;
      designationId?: string | null;
      branchId?: string | null;
      warehouseId?: string | null;
    },
    actorId?: string,
  ) {
    return this.prisma.userCompany.update({
      where: { userCompanyId },
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
        updatedBy: actorId ? parseBigIntId(actorId) : undefined,
        updatedAt: new Date(),
      },
      include: { user: true },
    });
  }

  updateMembershipStatus(
    userCompanyId: bigint,
    status: 'active' | 'suspended',
    actorId?: string,
  ) {
    return this.prisma.userCompany.update({
      where: { userCompanyId },
      data: {
        status,
        updatedBy: actorId ? parseBigIntId(actorId) : undefined,
        updatedAt: new Date(),
      },
      include: { user: true },
    });
  }

  async replaceModuleAccess(
    userId: string,
    companyId: string,
    items: { moduleId: string; accessType: 'grant' | 'deny' | null }[],
    actorId?: string,
  ) {
    const actor = actorId ? parseBigIntId(actorId) : undefined;
    return this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (item.accessType === null) {
          await tx.userModuleAccess.deleteMany({
            where: {
              userId: parseBigIntId(userId),
              companyId: parseBigIntId(companyId),
              moduleId: parseBigIntId(item.moduleId),
            },
          });
          continue;
        }

        await tx.userModuleAccess.upsert({
          where: {
            userId_companyId_moduleId: {
              userId: parseBigIntId(userId),
              companyId: parseBigIntId(companyId),
              moduleId: parseBigIntId(item.moduleId),
            },
          },
          update: {
            accessType: item.accessType as ModuleAccessType,
          },
          create: {
            userId: parseBigIntId(userId),
            companyId: parseBigIntId(companyId),
            moduleId: parseBigIntId(item.moduleId),
            accessType: item.accessType as ModuleAccessType,
            createdBy: actor,
          },
        });
      }

      return tx.userModuleAccess.findMany({
        where: {
          userId: parseBigIntId(userId),
          companyId: parseBigIntId(companyId),
        },
        include: { module: true },
      });
    });
  }

  async removeFromCompany(userId: string, companyId: string, actorId?: string) {
    const actor = actorId ? parseBigIntId(actorId) : undefined;
    return this.prisma.$transaction(async (tx) => {
      await tx.userCompany.updateMany({
        where: {
          userId: parseBigIntId(userId),
          companyId: parseBigIntId(companyId),
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
          deletedBy: actor,
          status: 'suspended',
          updatedAt: new Date(),
        },
      });

      await tx.userRole.updateMany({
        where: {
          userId: parseBigIntId(userId),
          companyId: parseBigIntId(companyId),
          isActive: true,
        },
        data: { isActive: false },
      });

      await tx.userModuleAccess.deleteMany({
        where: {
          userId: parseBigIntId(userId),
          companyId: parseBigIntId(companyId),
        },
      });
    });
  }
}
