import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { parseBigIntId } from '@/common/utils/bigint.util';

const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trial'] as const;

@Injectable()
export class CompanyAccessContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMembership(userId: string, companyId: string) { 
    return this.prisma.userCompany.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: 'active',
      },
      include: {
        user: true,
        company: true,
      },
    });
  }

  findUserCompanies(userId: string) {
    return this.prisma.userCompany.findMany({
      where: {
        userId: parseBigIntId(userId),
        deletedAt: null,
        status: 'active',
      },
      include: { company: true },
      orderBy: { isDefault: 'desc' },
    });
  }

  findActiveSubscription(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.companySubscription.findFirst({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
        status: { in: [...LIVE_SUBSCRIPTION_STATUSES] },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: { plan: true },
      orderBy: { startDate: 'desc' },
    });
  }

  findPlanModuleIds(planId: bigint) {
    return this.prisma.planModule.findMany({
      where: { planId },
      select: { moduleId: true },
    });
  }

  findCompanyModules(companyId: string) {
    return this.prisma.companyModule.findMany({
      where: {
        companyId: parseBigIntId(companyId),
        deletedAt: null,
      },
      select: {
        moduleId: true,
        isActive: true,
        expiryDate: true,
      },
    });
  }

  findPrimaryUserRole(userId: string, companyId: string) {
    return this.prisma.userRole.findFirst({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        isActive: true,
      },
      include: { role: true },
      orderBy: { roleId: 'asc' },
    });
  }

  countActiveUserRoles(userId: string, companyId: string) {
    return this.prisma.userRole.count({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        isActive: true,
      },
    });
  }

  findRolePermissionsByModule(roleId: bigint) {
    return this.prisma.role.findUnique({
      where: {
        roleId,
      },
      include: {
        rolePermissions: {
          where: { isAllowed: true },
          include: { permission: true, module: true },
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
                  include: {
                    permission: {
                      include: { module: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }).then((role) => {
      if (!role) return [];
      const direct = role.rolePermissions;
      const fromSets = role.rolePermissionSets.flatMap((rps) =>
        (rps.permissionSet?.permissionSetPermissions || []).map((psp) => ({
          permission: psp.permission,
          module: psp.permission?.module,
        })),
      );

      const seen = new Set<string>();
      const merged: Array<{
        permission: { action: string; permissionCode: string };
        module: { moduleType: string };
        moduleId: bigint;
      }> = [];

      for (const row of [
        ...direct.map((d) => ({
          permission: d.permission,
          module: d.module,
          moduleId: d.moduleId,
        })),
        ...fromSets
          .filter((s) => s.permission && s.module)
          .map((s) => ({
            permission: s.permission!,
            module: s.module!,
            moduleId: s.permission!.moduleId,
          })),
      ]) {
        const key = `${row.moduleId}:${row.permission.permissionCode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }

      return merged;
    });
  }

  findUserModuleAccess(userId: string, companyId: string) {
    return this.prisma.userModuleAccess.findMany({
      where: {
        userId: parseBigIntId(userId),
        companyId: parseBigIntId(companyId),
        OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }],
      },
      include: { module: true },
    });
  }

  findProductModules(moduleIds: bigint[]) {
    if (moduleIds.length === 0) return Promise.resolve([]);

    return this.prisma.module.findMany({
      where: {
        moduleId: { in: moduleIds },
        moduleType: 'product',
        deletedAt: null,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }
}

export { LIVE_SUBSCRIPTION_STATUSES };
