import { Injectable } from '@nestjs/common';
import { PermissionAction, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { PERMISSIONS } from '@/common/constants/permissions.constant';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { slugify } from '@/common/utils/helpers';

const MODULE_SEEDS = [
  { code: 'shared', name: 'Shared Master Data' },
  { code: 'organization', name: 'Organization' },
  { code: 'iam', name: 'Identity & Access' },
  { code: 'subscription', name: 'Subscription & Billing' },
] as const;

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
  }

  findActiveUserWithAuth(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null, isActive: true, isLocked: false },
      include: { authentication: true },
    });
  }

  async ensurePermissionsSeeded() {
    for (const mod of MODULE_SEEDS) {
      await this.prisma.module.upsert({
        where: { moduleCode: mod.code },
        update: {},
        create: {
          moduleCode: mod.code,
          moduleName: mod.name,
          isActive: true,
        },
      });
    }

    const modules = await this.prisma.module.findMany({
      where: { moduleCode: { in: MODULE_SEEDS.map((m) => m.code) } },
    });
    const moduleByCode = new Map(modules.map((m) => [m.moduleCode, m]));

    for (const perm of PERMISSIONS) {
      const mod = moduleByCode.get(perm.module);
      if (!mod) continue;

      await this.prisma.permission.upsert({
        where: {
          moduleId_permissionCode: {
            moduleId: mod.moduleId,
            permissionCode: perm.code,
          },
        },
        update: {},
        create: {
          moduleId: mod.moduleId,
          permissionCode: perm.code,
          permissionName: perm.name,
          action: perm.action as PermissionAction,
        },
      });
    }
  }

  async getAllPermissions() {
    await this.ensurePermissionsSeeded();
    return this.prisma.permission.findMany();
  }

  findCompanyByCode(companyCode: string) {
    return this.prisma.company.findFirst({
      where: { companyCode, deletedAt: null },
    });
  }

  findUserCompanies(userId: string) {
    return this.prisma.userCompany.findMany({
      where: {
        userId: parseBigIntId(userId),
        deletedAt: null,
        status: { in: ['active', 'invited'] },
      },
      include: {
        company: true,
        user: true,
      },
    });
  }

  findMembership(userId: string, companyId: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'active',
      },
      include: { company: true, user: true },
    });
  }

  async findMembershipWithPermissions(userId: string, companyId: string) {
    const membership = await this.findMembership(userId, companyId);
    if (!membership) return null;

    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        isActive: true,
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              where: { isAllowed: true },
              include: { permission: true },
            },
          },
        },
      },
    });

    const permissions = [
      ...new Set(
        userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.permissionCode),
        ),
      ),
    ];

    const primaryRole = userRoles[0]?.role;

    return {
      user: membership.user,
      company: membership.company,
      role: primaryRole,
      permissions,
      userRoles,
    };
  }

  async updateLastLogin(userId: string) {
    await this.prisma.userAuthentication.update({
      where: { userId: parseBigIntId(userId) },
      data: {
        lastSuccessfulLogin: new Date(),
        failedLoginCount: 0,
        updatedAt: new Date(),
      },
    });
  }

  async createSignupTransaction(params: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    companyName: string;
    permissionIds: bigint[];
  }) {
    const username = params.email.split('@')[0];
    let companyCode = slugify(params.companyName).toUpperCase().replace(/-/g, '_');
    if (companyCode.length > 30) companyCode = companyCode.slice(0, 30);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email: params.email,
          firstName: params.firstName,
          lastName: params.lastName,
          displayName: `${params.firstName} ${params.lastName}`.trim(),
        },
      });

      await tx.userAuthentication.create({
        data: {
          userId: user.userId,
          passwordHash: params.passwordHash,
          isEmailVerified: false,
        },
      });

      const company = await tx.company.create({
        data: {
          companyCode,
          name: params.companyName,
          status: 'trial',
        },
      });

      const role = await tx.role.create({
        data: {
          companyId: company.companyId,
          roleCode: 'ADMIN',
          roleName: 'Administrator',
          isSystem: true,
          createdBy: user.userId,
        },
      });

      const modules = await tx.module.findMany();
      const moduleById = new Map(modules.map((m) => [m.moduleId, m]));

      for (const permissionId of params.permissionIds) {
        const permission = await tx.permission.findUnique({ where: { permissionId } });
        if (!permission) continue;

        await tx.rolePermission.create({
          data: {
            roleId: role.roleId,
            moduleId: permission.moduleId,
            permissionId: permission.permissionId,
            isAllowed: true,
            createdBy: user.userId,
          },
        });
      }

      await tx.userCompany.create({
        data: {
          userId: user.userId,
          companyId: company.companyId,
          status: 'active',
          isDefault: true,
          createdBy: user.userId,
        },
      });

      await tx.userRole.create({
        data: {
          userId: user.userId,
          companyId: company.companyId,
          roleId: role.roleId,
          assignedBy: user.userId,
        },
      });

      return {
        user: { id: user.userId.toString(), email: user.email, firstName: user.firstName ?? '', lastName: user.lastName ?? '' },
        company: { id: company.companyId.toString(), name: company.name, companyCode: company.companyCode },
        role: { id: role.roleId.toString(), name: role.roleName },
      };
    });
  }

  async recordFailedLogin(userId: string) {
    await this.prisma.userAuthentication.update({
      where: { userId: parseBigIntId(userId) },
      data: {
        failedLoginCount: { increment: 1 },
        lastFailedLogin: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async createSession(data: Prisma.UserSessionUncheckedCreateInput) {
    return this.prisma.userSession.create({ data });
  }

  async revokeSession(sessionId: string) {
    return this.prisma.userSession.update({
      where: { sessionId: parseBigIntId(sessionId) },
      data: { sessionStatus: 'logged_out', logoutTime: new Date() },
    });
  }
}
