import { Injectable } from '@nestjs/common';
import { PermissionAction, Prisma } from '@prisma/client';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { ALL_MODULES } from '@/common/constants/modules.constant';
import { PERMISSIONS } from '@/common/constants/permissions.constant';
import { parseBigIntId } from '@/common/utils/bigint.util';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Process-local cache so login+/me don't re-run heavy upserts every request. */
  private static securityOrgSeedReady = false;
  private static securityOrgSeedInFlight: Promise<void> | null = null;

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

  /** Catalog codes introduced in Security & Organization V1 — grant to existing ADMIN roles. */
  private static readonly SECURITY_ORG_V1_ADMIN_CODES = [
    'permission_sets:view',
    'permission_sets:create',
    'permission_sets:edit',
    'permission_sets:delete',
    'data_access_policies:view',
    'data_access_policies:create',
    'data_access_policies:edit',
    'data_access_policies:delete',
  ] as const;

  /**
   * Ensures permission catalog rows exist and grants Security Org V1 codes to
   * every company role with roleCode === 'ADMIN' (DEMO_ACME ADMIN included).
   * Idempotent + single-flight — safe on concurrent login /me / signup.
   */
  async ensurePermissionsSeeded() {
    if (AuthRepository.securityOrgSeedReady) return;
    if (AuthRepository.securityOrgSeedInFlight) {
      await AuthRepository.securityOrgSeedInFlight;
      return;
    }

    AuthRepository.securityOrgSeedInFlight = this.runSecurityOrgSeed()
      .then(() => {
        AuthRepository.securityOrgSeedReady = true;
      })
      .finally(() => {
        AuthRepository.securityOrgSeedInFlight = null;
      });

    await AuthRepository.securityOrgSeedInFlight;
  }

  private async runSecurityOrgSeed() {
    const v1Codes = AuthRepository.SECURITY_ORG_V1_ADMIN_CODES;
    const existingV1 = await this.prisma.permission.findMany({
      where: { permissionCode: { in: [...v1Codes] } },
      select: { permissionCode: true },
    });
    const have = new Set(existingV1.map((p) => p.permissionCode));
    const missingV1 = v1Codes.filter((code) => !have.has(code));

    const existingCount = await this.prisma.permission.count();
    if (existingCount < PERMISSIONS.length) {
      await this.upsertModulesAndPermissions(PERMISSIONS);
    } else if (missingV1.length > 0) {
      const missingSet = new Set<string>(missingV1);
      const securityOrgPerms = PERMISSIONS.filter((p) => missingSet.has(p.code));
      await this.upsertModulesAndPermissions(securityOrgPerms);
    }

    await this.backfillAdminSecurityOrgPermissions();
  }

  private async upsertModulesAndPermissions(
    perms: readonly { module: string; code: string; name: string; action: string }[],
  ) {
    const moduleCodes = [...new Set(perms.map((p) => p.module))];
    const modulesToUpsert = ALL_MODULES.filter((m) => moduleCodes.includes(m.code));

    for (const mod of modulesToUpsert) {
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
      where: { moduleCode: { in: moduleCodes } },
    });
    const moduleByCode = new Map(modules.map((m) => [m.moduleCode, m]));

    for (const perm of perms) {
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

  /**
   * Existing company ADMIN roles predate Security & Organization V1 codes.
   * Idempotent: createMany skipDuplicates so tabs/APIs stop returning 403 after re-login.
   */
  private async backfillAdminSecurityOrgPermissions() {
    const permissions = await this.prisma.permission.findMany({
      where: {
        permissionCode: {
          in: [...AuthRepository.SECURITY_ORG_V1_ADMIN_CODES],
        },
      },
      select: { permissionId: true, moduleId: true },
    });
    if (permissions.length === 0) return;

    // Seed + signup create roleCode exactly 'ADMIN' (DEMO_ACME ADMIN001 included).
    const adminRoles = await this.prisma.role.findMany({
      where: { roleCode: 'ADMIN', deletedAt: null },
      select: { roleId: true },
    });
    if (adminRoles.length === 0) return;

    for (const role of adminRoles) {
      await this.prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.roleId,
          moduleId: permission.moduleId,
          permissionId: permission.permissionId,
          isAllowed: true,
        })),
        skipDuplicates: true,
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
            rolePermissionSets: {
              where: {
                permissionSet: {
                  deletedAt: null,
                  isActive: true,
                },
              },
              include: {
                permissionSet: {
                  include: {
                    permissionSetPermissions: {
                      include: { permission: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const permissions = [
      ...new Set(
        userRoles.flatMap((ur) =>
          [
            ...ur.role.rolePermissions.map((rp) => rp.permission?.permissionCode),
            ...ur.role.rolePermissionSets.flatMap((rps) =>
              (rps.permissionSet?.permissionSetPermissions || []).map(
                (psp) => psp.permission?.permissionCode,
              ),
            ),
          ].filter((code): code is string => Boolean(code)),
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
