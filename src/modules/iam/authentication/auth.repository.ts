import { Injectable } from '@nestjs/common';
import { PermissionAction, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { ALL_MODULES } from '@/common/constants/modules.constant';
import { PERMISSIONS } from '@/common/constants/permissions.constant';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { slugify } from '@/common/utils/helpers';

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
    const existingCount = await this.prisma.permission.count();
    if (existingCount >= PERMISSIONS.length) {
      return;
    }

    for (const mod of ALL_MODULES) {
      await this.prisma.module.upsert({
        where: { moduleCode: mod.code },
        update: {
          moduleName: mod.name,
          moduleType: mod.moduleType,
          sortOrder: mod.sortOrder,
          description: mod.description,
          icon: mod.icon,
          isActive: true,
        },
        create: {
          moduleCode: mod.code,
          moduleName: mod.name,
          moduleType: mod.moduleType,
          sortOrder: mod.sortOrder,
          description: mod.description,
          icon: mod.icon,
          isActive: true,
        },
      });
    }

    const modules = await this.prisma.module.findMany({
      where: { moduleCode: { in: ALL_MODULES.map((m) => m.code) } },
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
      where: { companyCode: companyCode.trim().toUpperCase(), deletedAt: null },
    });
  }

  findCompanyById(companyId: string) {
    return this.prisma.company.findFirst({
      where: { companyId: parseBigIntId(companyId), deletedAt: null },
    });
  }

  findMembershipByEmployeeCode(companyId: string, employeeCode: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        employeeId: employeeCode.trim(),
        deletedAt: null,
        status: 'active',
      },
      include: {
        user: { include: { authentication: true } },
        company: true,
      },
    });
  }

  async recordLoginHistory(params: {
    userId?: string;
    companyId?: string;
    loginResult: 'success' | 'failure';
    failureReason?: string;
    ipAddress?: string;
    browser?: string;
  }) {
    return this.prisma.userLoginHistory.create({
      data: {
        userId: params.userId ? parseBigIntId(params.userId) : null,
        companyId: params.companyId ? parseBigIntId(params.companyId) : null,
        loginResult: params.loginResult,
        failureReason: params.failureReason,
        ipAddress: params.ipAddress,
        browser: params.browser,
      },
    });
  }

  findSessionByRefreshToken(refreshToken: string) {
    return this.prisma.userSession.findFirst({
      where: { refreshToken, sessionStatus: 'active' },
      orderBy: { loginTime: 'desc' },
    });
  }

  async revokeSessionsByRefreshToken(refreshToken: string) {
    return this.prisma.userSession.updateMany({
      where: { refreshToken, sessionStatus: 'active' },
      data: { sessionStatus: 'logged_out', logoutTime: new Date() },
    });
  }

  async revokeSessionBySid(sid: string) {
    return this.prisma.userSession.updateMany({
      where: { jwtToken: sid, sessionStatus: 'active' },
      data: { sessionStatus: 'logged_out', logoutTime: new Date() },
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
      orderBy: { roleId: 'asc' },
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
    adminPermissions: { permissionId: bigint; moduleId: bigint }[];
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

      if (params.adminPermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: params.adminPermissions.map((permission) => ({
            roleId: role.roleId,
            moduleId: permission.moduleId,
            permissionId: permission.permissionId,
            isAllowed: true,
            createdBy: user.userId,
          })),
        });
      }

      await tx.userCompany.create({
        data: {
          userId: user.userId,
          companyId: company.companyId,
          employeeId: `EMP-${String(user.userId).padStart(5, '0')}`,
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

      await tx.companySecurityPolicy.create({
        data: {
          companyId: company.companyId,
          createdBy: user.userId,
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
    await this.incrementFailedLogin(userId);
  }

  findAuthentication(userId: string) {
    return this.prisma.userAuthentication.findUnique({
      where: { userId: parseBigIntId(userId) },
    });
  }

  incrementFailedLogin(userId: string) {
    return this.prisma.userAuthentication.update({
      where: { userId: parseBigIntId(userId) },
      data: {
        failedLoginCount: { increment: 1 },
        lastFailedLogin: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async clearAccountLock(userId: string) {
    await this.prisma.$transaction([
      this.prisma.userAuthentication.update({
        where: { userId: parseBigIntId(userId) },
        data: {
          accountLockedUntil: null,
          failedLoginCount: 0,
          updatedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { userId: parseBigIntId(userId) },
        data: {
          isLocked: false,
          lockReason: null,
          updatedAt: new Date(),
        },
      }),
    ]);
  }

  async lockAccount(userId: string, lockedUntil: Date, reason: string) {
    await this.prisma.$transaction([
      this.prisma.userAuthentication.update({
        where: { userId: parseBigIntId(userId) },
        data: {
          accountLockedUntil: lockedUntil,
          updatedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { userId: parseBigIntId(userId) },
        data: {
          isLocked: true,
          lockReason: reason,
          updatedAt: new Date(),
        },
      }),
    ]);
  }

  findSecurityPolicy(companyId: string) {
    return this.prisma.companySecurityPolicy.findUnique({
      where: { companyId: parseBigIntId(companyId) },
    });
  }

  ensureDefaultSecurityPolicy(companyId: string, createdBy?: string) {
    return this.prisma.companySecurityPolicy.upsert({
      where: { companyId: parseBigIntId(companyId) },
      update: {},
      create: {
        companyId: parseBigIntId(companyId),
        createdBy: createdBy ? parseBigIntId(createdBy) : undefined,
      },
    });
  }

  findOAuthIdentity(provider: string, providerUserId: string) {
    return this.prisma.userOAuthIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: provider as 'google' | 'microsoft',
          providerUserId,
        },
      },
      include: {
        user: { include: { authentication: true } },
      },
    });
  }

  findMembershipByUserAndCompany(userId: string, companyId: string) {
    return this.findMembership(userId, companyId);
  }

  findMembershipByEmail(companyId: string, email: string) {
    return this.prisma.userCompany.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'active',
        user: {
          email: email.trim().toLowerCase(),
          deletedAt: null,
          isActive: true,
        },
      },
      include: {
        user: { include: { authentication: true } },
        company: true,
      },
    });
  }

  upsertOAuthIdentity(params: {
    userId: string;
    provider: 'google' | 'microsoft';
    providerUserId: string;
    email?: string;
    displayName?: string;
  }) {
    return this.prisma.userOAuthIdentity.upsert({
      where: {
        provider_providerUserId: {
          provider: params.provider,
          providerUserId: params.providerUserId,
        },
      },
      update: {
        email: params.email,
        displayName: params.displayName,
        updatedAt: new Date(),
      },
      create: {
        userId: parseBigIntId(params.userId),
        provider: params.provider,
        providerUserId: params.providerUserId,
        email: params.email,
        displayName: params.displayName,
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

  findAuthenticationByUserId(userId: string) {
    return this.prisma.userAuthentication.findUnique({
      where: { userId: parseBigIntId(userId) },
    });
  }

  async getMustChangePassword(userId: string): Promise<boolean> {
    const auth = await this.findAuthenticationByUserId(userId);
    return Boolean(auth?.mustChangePassword);
  }

  async changePassword(params: {
    userId: string;
    newPasswordHash: string;
    previousPasswordHash: string;
    changedBy?: string;
  }) {
    const userId = parseBigIntId(params.userId);

    return this.prisma.$transaction(async (tx) => {
      await tx.userPasswordHistory.create({
        data: {
          userId,
          passwordHash: params.previousPasswordHash,
          hashAlgorithm: 'bcrypt',
          changedBy: params.changedBy ? parseBigIntId(params.changedBy) : userId,
        },
      });

      return tx.userAuthentication.update({
        where: { userId },
        data: {
          passwordHash: params.newPasswordHash,
          mustChangePassword: false,
          passwordExpiresDate: null,
          passwordChangedDate: new Date(),
          lastPasswordReset: new Date(),
          updatedAt: new Date(),
        },
      });
    });
  }
}
