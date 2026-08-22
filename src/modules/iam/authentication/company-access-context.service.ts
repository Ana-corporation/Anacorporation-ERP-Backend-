import { Injectable, Logger } from '@nestjs/common';
import { PermissionAction } from '@prisma/client';
import {
  PHASE1_PERMISSION_ACTIONS,
  Phase1PermissionAction,
} from '@/common/constants/modules.constant';
import {
  ForbiddenException,
  NotFoundException,
} from '@/common/exceptions/business.exception';
import { CompanyAccessContextRepository } from './company-access-context.repository';
import {
  CompanyAccessContext,
  CompanyAccessModuleSummary,
} from './interfaces/company-access-context.interface';

const PHASE1_ACTION_SET = new Set<string>(PHASE1_PERMISSION_ACTIONS);

@Injectable()
export class CompanyAccessContextService {
  private readonly logger = new Logger(CompanyAccessContextService.name);

  constructor(private readonly repository: CompanyAccessContextRepository) {}

  async buildCompanyAccessContext(
    userId: string,
    companyId: string,
  ): Promise<CompanyAccessContext> {
    const membership = await this.repository.findMembership(userId, companyId);
    if (!membership) {
      throw new NotFoundException('Company membership');
    }

    const company = membership.company;
    if (company.deletedAt) {
      throw new NotFoundException('Company');
    }
    if (company.status === 'suspended' || company.status === 'cancelled') {
      throw new ForbiddenException(
        company.status === 'suspended'
          ? 'Company account is suspended'
          : 'Company account is cancelled',
      );
    }

    const [companies, subscription, primaryRole, roleCount, overrides] =
      await Promise.all([
        this.repository.findUserCompanies(userId),
        this.repository.findActiveSubscription(companyId),
        this.repository.findPrimaryUserRole(userId, companyId),
        this.repository.countActiveUserRoles(userId, companyId),
        this.repository.findUserModuleAccess(userId, companyId),
      ]);

    if (roleCount > 1) {
      this.logger.warn(
        `User ${userId} has ${roleCount} active roles in company ${companyId}; using primary role only`,
      );
    }

    const entitled = await this.resolveEntitledModuleIds(companyId, subscription?.planId);
    const modules = await this.buildModuleSnapshot({
      userId,
      companyId,
      entitledModuleIds: entitled.moduleIds,
      companyModuleActiveById: entitled.activeByModuleId,
      roleId: primaryRole?.roleId,
      overrides,
    });

    const user = membership.user;

    return {
      user: {
        userId: user.userId.toString(),
        username: user.username,
        displayName: user.displayName ?? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
        email: user.email,
      },
      companies: companies.map((row) => ({
        companyId: row.company.companyId.toString(),
        companyCode: row.company.companyCode,
        name: row.company.name,
        isDefault: row.isDefault,
        status: row.company.status,
      })),
      activeCompany: {
        companyId: company.companyId.toString(),
        companyCode: company.companyCode,
        name: company.name,
        status: company.status,
        role: primaryRole?.role
          ? {
              roleId: primaryRole.role.roleId.toString(),
              roleCode: primaryRole.role.roleCode,
              roleName: primaryRole.role.roleName,
            }
          : null,
        subscription: {
          status: subscription?.status ?? 'none',
          planCode: subscription?.plan.planCode ?? null,
          planName: subscription?.plan.name ?? null,
          startDate: subscription?.startDate
            ? subscription.startDate.toISOString().slice(0, 10)
            : null,
          endDate: subscription?.endDate
            ? subscription.endDate.toISOString().slice(0, 10)
            : null,
          isCustom: entitled.isCustom,
        },
        modules,
      },
    };
  }

  private async resolveEntitledModuleIds(
    companyId: string,
    planId?: bigint,
  ): Promise<{
    moduleIds: bigint[];
    activeByModuleId: Map<string, boolean>;
    isCustom: boolean;
  }> {
    const activeByModuleId = new Map<string, boolean>();

    if (!planId) {
      return { moduleIds: [], activeByModuleId, isCustom: false };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [planModules, companyModules] = await Promise.all([
      this.repository.findPlanModuleIds(planId),
      this.repository.findCompanyModules(companyId),
    ]);

    const planSet = new Set(planModules.map((row) => row.moduleId.toString()));
    // Workspace entitlement requires an ACTIVE company_modules row (plan alone is not enough).
    const entitled = new Set<string>();

    for (const row of companyModules) {
      const key = row.moduleId.toString();
      const notExpired = !row.expiryDate || row.expiryDate >= today;

      if (row.isActive && notExpired) {
        entitled.add(key);
        activeByModuleId.set(key, true);
      } else {
        activeByModuleId.set(key, false);
      }
    }

    const isCustom =
      companyModules.length > 0 &&
      (companyModules.some((row) => !planSet.has(row.moduleId.toString())) ||
        companyModules.some((row) => !row.isActive));

    return {
      moduleIds: [...entitled].map((id) => BigInt(id)),
      activeByModuleId,
      isCustom,
    };
  }

  private async buildModuleSnapshot(params: {
    userId: string;
    companyId: string;
    entitledModuleIds: bigint[];
    companyModuleActiveById: Map<string, boolean>;
    roleId?: bigint;
    overrides: Awaited<ReturnType<CompanyAccessContextRepository['findUserModuleAccess']>>;
  }): Promise<CompanyAccessModuleSummary[]> {
    const { entitledModuleIds, companyModuleActiveById, roleId, overrides } = params;

    const grantModuleIds = overrides
      .filter((row) => row.accessType === 'grant' && row.module.moduleType === 'product')
      .map((row) => row.moduleId);

    const denyModuleIds = new Set(
      overrides
        .filter((row) => row.accessType === 'deny')
        .map((row) => row.moduleId.toString()),
    );

    const moduleIdSet = new Set(entitledModuleIds.map((id) => id.toString()));
    for (const id of grantModuleIds) {
      moduleIdSet.add(id.toString());
    }
    for (const denied of denyModuleIds) {
      moduleIdSet.delete(denied);
    }

    const moduleIds = [...moduleIdSet].map((id) => BigInt(id));
    const productModules = await this.repository.findProductModules(moduleIds);

    const permissionsByModuleId = new Map<string, Phase1PermissionAction[]>();
    if (roleId) {
      const rolePermissions = await this.repository.findRolePermissionsByModule(roleId);
      for (const row of rolePermissions) {
        if (row.module.moduleType !== 'product') continue;
        if (!this.isPhase1Action(row.permission.action)) continue;

        const key = row.moduleId.toString();
        const list = permissionsByModuleId.get(key) ?? [];
        if (!list.includes(row.permission.action as Phase1PermissionAction)) {
          list.push(row.permission.action as Phase1PermissionAction);
        }
        permissionsByModuleId.set(key, list);
      }
    }

    for (const row of overrides) {
      if (row.accessType !== 'grant' || row.module.moduleType !== 'product') continue;
      const key = row.moduleId.toString();
      if (!permissionsByModuleId.has(key)) {
        permissionsByModuleId.set(key, ['view']);
      }
    }

    return productModules
      .filter((mod) => {
        const key = mod.moduleId.toString();
        // Spec: company_modules.isActive === true (explicit entitlement row)
        if (companyModuleActiveById.get(key) !== true) return false;
        const perms = permissionsByModuleId.get(key) ?? [];
        // Spec: user has at least view (or any Phase-1 action) on the module
        return perms.includes('view') || perms.length > 0;
      })
      .map((mod) => {
        const key = mod.moduleId.toString();
        return {
          moduleId: Number(mod.moduleId),
          moduleCode: mod.moduleCode,
          moduleName: mod.moduleName,
          isActive: true,
          permissions: permissionsByModuleId.get(key) ?? [],
        };
      });
  }

  private isPhase1Action(action: PermissionAction | string): action is Phase1PermissionAction {
    return PHASE1_ACTION_SET.has(String(action));
  }
}
