import { Injectable } from '@nestjs/common';
import { EntitlementRepository } from './entitlement.repository';
import {
  EffectiveEntitlementModule,
  EffectiveEntitlementsResult,
  EntitlementSource,
  LIVE_SUBSCRIPTION_STATUSES,
} from './entitlement.types';

@Injectable()
export class EntitlementService {
  constructor(private readonly repository: EntitlementRepository) {}

  /**
   * Single source of truth for commercial entitlement + tenant enablement.
   *
   * Resolution priority: REVOKE → GRANT → PLAN
   * enabled      = company_modules.isEnabled (default true when entitled, no row)
   * effectiveAccess = subscriptionValid AND entitled AND enabled
   */
  async getEffectiveEntitlements(companyId: string): Promise<EffectiveEntitlementsResult> {
    const company = await this.repository.findCompany(companyId);
    if (!company) {
      return this.emptyResult(companyId, 'unknown');
    }

    const subscription = await this.repository.findLiveSubscription(companyId);
    const subscriptionValid = Boolean(
      subscription && LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status),
    );

    const planModuleIds = subscription?.planId
      ? (await this.repository.findPlanModuleIds(subscription.planId)).map((r) =>
          r.moduleId.toString(),
        )
      : [];

    const planSet = new Set(planModuleIds);
    const overrides = await this.repository.findActiveOverrides(companyId);

    const overrideByModuleId = new Map<string, 'GRANT' | 'REVOKE'>();
    for (const row of overrides) {
      if (row.module.deletedAt || row.module.moduleType !== 'product') continue;
      if (
        row.module.lifecycleStatus !== 'AVAILABLE' &&
        row.module.lifecycleStatus !== 'DEPRECATED'
      ) {
        continue;
      }
      overrideByModuleId.set(row.moduleId.toString(), row.action);
    }

    const entitledSet = new Set(planModuleIds);
    for (const [moduleId, action] of overrideByModuleId) {
      if (action === 'GRANT') entitledSet.add(moduleId);
      if (action === 'REVOKE') entitledSet.delete(moduleId);
    }

    const settings = await this.repository.findCompanyModuleSettings(companyId);
    const enabledByModuleId = new Map<string, boolean>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const row of settings) {
      const key = row.moduleId.toString();
      const notExpired = !row.expiryDate || row.expiryDate >= today;
      enabledByModuleId.set(key, notExpired && row.isEnabled);
    }

    const catalogue = await this.repository.findAllTenantProductModules();

    const modules: EffectiveEntitlementModule[] = catalogue.map((mod) => {
      const key = mod.moduleId.toString();
      const planIncluded = planSet.has(key);
      const overrideType = overrideByModuleId.get(key) ?? null;
      const entitled = entitledSet.has(key);
      const source = this.resolveSource({ entitled, planIncluded, overrideType });
      const enabled = entitled ? (enabledByModuleId.get(key) ?? true) : false;
      const effectiveAccess = subscriptionValid && entitled && enabled;

      return {
        moduleId: key,
        code: mod.moduleCode,
        name: mod.moduleName,
        lifecycleStatus: mod.lifecycleStatus,
        entitled,
        enabled,
        effectiveAccess,
        source,
        planIncluded,
        overrideType,
      };
    });

    modules.sort((a, b) => a.code.localeCompare(b.code));

    const isCustom =
      overrides.some((o) => o.action === 'GRANT') ||
      overrides.some((o) => o.action === 'REVOKE') ||
      settings.some((s) => !planSet.has(s.moduleId.toString()));

    return {
      companyId,
      companyStatus: company.status,
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
        autoRenew: subscription?.autoRenew ?? false,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
        isValid: subscriptionValid,
      },
      modules,
      isCustom,
    };
  }

  /** Module codes with effective product access (for auth/me summary). */
  async getEffectiveModuleCodes(companyId: string): Promise<string[]> {
    const snapshot = await this.getEffectiveEntitlements(companyId);
    return snapshot.modules.filter((m) => m.effectiveAccess).map((m) => m.code);
  }

  async ensureDefaultSettingsForPlan(companyId: string, actorId?: string) {
    const snapshot = await this.getEffectiveEntitlements(companyId);
    for (const mod of snapshot.modules.filter((m) => m.entitled)) {
      await this.repository.upsertCompanyModuleSetting({
        companyId,
        moduleId: mod.moduleId,
        isEnabled: true,
        actorId,
      });
    }
  }

  async setModuleEnabled(params: {
    companyId: string;
    moduleId: string;
    enabled: boolean;
    actorId: string;
  }) {
    const snapshot = await this.getEffectiveEntitlements(params.companyId);
    const mod = snapshot.modules.find((m) => m.moduleId === params.moduleId);
    if (!mod?.entitled) {
      return { ok: false as const, reason: 'not_entitled' as const };
    }

    await this.repository.upsertCompanyModuleSetting({
      companyId: params.companyId,
      moduleId: params.moduleId,
      isEnabled: params.enabled,
      actorId: params.actorId,
    });

    return { ok: true as const };
  }

  private resolveSource(params: {
    entitled: boolean;
    planIncluded: boolean;
    overrideType: 'GRANT' | 'REVOKE' | null;
  }): EntitlementSource {
    if (!params.entitled) return 'NONE';
    if (params.overrideType === 'GRANT') return 'GRANT';
    if (params.planIncluded) return 'PLAN';
    return 'GRANT';
  }

  private emptyResult(companyId: string, companyStatus: string): EffectiveEntitlementsResult {
    return {
      companyId,
      companyStatus,
      subscription: {
        status: 'none',
        planCode: null,
        planName: null,
        startDate: null,
        endDate: null,
        autoRenew: false,
        cancelAtPeriodEnd: false,
        isValid: false,
      },
      modules: [],
      isCustom: false,
    };
  }
}
