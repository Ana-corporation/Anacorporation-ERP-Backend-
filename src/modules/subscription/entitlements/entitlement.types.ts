import { SubscriptionStatus } from '@prisma/client';

export const LIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['active', 'trial'];

export const TENANT_VISIBLE_LIFECYCLES = ['AVAILABLE', 'DEPRECATED'] as const;

export type EntitlementSource = 'PLAN' | 'GRANT' | 'NONE';

export interface EffectiveEntitlementModule {
  moduleId: string;
  code: string;
  name: string;
  lifecycleStatus: string;
  entitled: boolean;
  enabled: boolean;
  effectiveAccess: boolean;
  /** Commercial origin after override resolution. */
  source: EntitlementSource;
  /** Whether module is on the current subscription plan (before REVOKE). */
  planIncluded: boolean;
  /** Active company override type, if any. */
  overrideType: 'GRANT' | 'REVOKE' | null;
}

export interface EffectiveEntitlementsSubscription {
  status: string;
  planCode: string | null;
  planName: string | null;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  isValid: boolean;
}

export interface EffectiveEntitlementsResult {
  companyId: string;
  companyStatus: string;
  subscription: EffectiveEntitlementsSubscription;
  modules: EffectiveEntitlementModule[];
  isCustom: boolean;
}
