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
import { EntitlementService } from '@/modules/subscription/entitlements/entitlement.service';
import { CompanyAccessContextRepository } from './company-access-context.repository';
import {
  CompanyAccessContext,
  CompanyAccessModuleSummary,
} from './interfaces/company-access-context.interface';

const PHASE1_ACTION_SET = new Set<string>(PHASE1_PERMISSION_ACTIONS);

@Injectable()
export class CompanyAccessContextService {
  private readonly logger = new Logger(CompanyAccessContextService.name);

  constructor(
    private readonly repository: CompanyAccessContextRepository,
    private readonly entitlementService: EntitlementService,
  ) {}

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

    const [companies, primaryRole, roleCount, overrides, entitlements] =
      await Promise.all([
        this.repository.findUserCompanies(userId),
        this.repository.findPrimaryUserRole(userId, companyId),
        this.repository.countActiveUserRoles(userId, companyId),
        this.repository.findUserModuleAccess(userId, companyId),
        this.entitlementService.getEffectiveEntitlements(companyId),
      ]);

    if (roleCount > 1) {
      this.logger.warn(
        `User ${userId} has ${roleCount} active roles in company ${companyId}; using primary role only`,
      );
    }

    const modules = await this.buildModuleSnapshot({
      entitlements,
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
              systemTemplateKey: primaryRole.role.systemTemplateKey ?? null,
              roleType: primaryRole.role.roleType ?? null,
              isSystem: primaryRole.role.isSystem,
            }
          : null,
        subscription: {
          status: entitlements.subscription.status,
          planCode: entitlements.subscription.planCode,
          planName: entitlements.subscription.planName,
          startDate: entitlements.subscription.startDate,
          endDate: entitlements.subscription.endDate,
          isCustom: entitlements.isCustom,
          autoRenew: entitlements.subscription.autoRenew,
          cancelAtPeriodEnd: entitlements.subscription.cancelAtPeriodEnd,
          isValid: entitlements.subscription.isValid,
        },
        modules,
      },
    };
  }

  private async buildModuleSnapshot(params: {
    entitlements: Awaited<ReturnType<EntitlementService['getEffectiveEntitlements']>>;
    roleId?: bigint;
    overrides: Awaited<ReturnType<CompanyAccessContextRepository['findUserModuleAccess']>>;
  }): Promise<CompanyAccessModuleSummary[]> {
    const { entitlements, roleId, overrides } = params;

    const permissionsByModuleId = new Map<string, Phase1PermissionAction[]>();
    let supplyChainEntitledByRole: string | null = null;

    if (roleId) {
      const rolePermissions = await this.repository.findRolePermissionsByModule(roleId);
      for (const row of rolePermissions) {
        if (row.module.moduleType !== 'product') continue;

        const action = this.resolveProductModuleAction(
          row.permission.permissionCode,
          row.permission.action,
        );
        if (!action) continue;

        const key = row.moduleId.toString();
        const list = permissionsByModuleId.get(key) ?? [];
        if (!list.includes(action)) {
          list.push(action);
        }
        permissionsByModuleId.set(key, list);

        if (this.isSupplyChainResourcePermission(row.permission.permissionCode)) {
          supplyChainEntitledByRole = key;
        }
      }
    }

    const grantModuleIds = overrides
      .filter((row) => row.accessType === 'grant' && row.module.moduleType === 'product')
      .map((row) => row.moduleId.toString());

    const denyModuleIds = new Set(
      overrides
        .filter((row) => row.accessType === 'deny')
        .map((row) => row.moduleId.toString()),
    );

    if (supplyChainEntitledByRole) {
      denyModuleIds.delete(supplyChainEntitledByRole);
    }

    return entitlements.modules
      .filter((mod) => mod.entitled)
      .flatMap((mod): CompanyAccessModuleSummary[] => {
        const key = mod.moduleId;
        const perms = [...(permissionsByModuleId.get(key) ?? [])];

        if (grantModuleIds.includes(key) && !perms.includes('view')) {
          perms.push('view');
        }
        if (denyModuleIds.has(key) && !supplyChainEntitledByRole) {
          return [];
        }

        if (perms.length === 0) return [];

        const effectiveAccess = mod.effectiveAccess && entitlements.subscription.isValid;

        return [
          {
            moduleId: Number(mod.moduleId),
            moduleCode: mod.code,
            moduleName: mod.name,
            entitled: mod.entitled,
            enabled: mod.enabled,
            effectiveAccess,
            isActive: effectiveAccess,
            lifecycleStatus: mod.lifecycleStatus,
            permissions: perms,
          },
        ];
      });
  }

  private resolveProductModuleAction(
    permissionCode: string,
    action: string,
  ): Phase1PermissionAction | null {
    const resourceMatch = /^(vendors|items):(view|create|edit|delete|approve)$/.exec(
      permissionCode,
    );
    if (resourceMatch) {
      return resourceMatch[2] as Phase1PermissionAction;
    }
    if (this.isPhase1Action(action)) {
      return action;
    }
    return null;
  }

  private isSupplyChainResourcePermission(permissionCode: string): boolean {
    return (
      permissionCode.startsWith('vendors:') ||
      permissionCode.startsWith('items:') ||
      permissionCode.startsWith('supply-chain:')
    );
  }

  private isPhase1Action(action: PermissionAction | string): action is Phase1PermissionAction {
    return PHASE1_ACTION_SET.has(String(action));
  }
}
