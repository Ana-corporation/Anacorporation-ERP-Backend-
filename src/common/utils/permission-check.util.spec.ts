import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  checkModulePermission,
  checkPermission,
  checkPermissionCode,
} from './permission-check.util';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    sub: '1',
    email: 'user@test.com',
    sessionId: 'sess-1',
    companyId: '15',
    role: 'ADMIN',
    permissions: [],
    modules: [],
    subscriptionStatus: 'none',
    firstName: 'Test',
    lastName: 'User',
    ...overrides,
  };
}

describe('permission-check.util', () => {
  const crmModule = {
    moduleId: 1,
    moduleCode: 'crm',
    moduleName: 'CRM',
    isActive: true,
    permissions: ['view', 'create'] as ('view' | 'create' | 'edit' | 'delete' | 'approve')[],
  };

  const supplyChainModule = {
    moduleId: 2,
    moduleCode: 'supply-chain',
    moduleName: 'Supply Chain',
    isActive: true,
    permissions: ['view', 'create', 'edit', 'delete', 'approve'] as (
      | 'view'
      | 'create'
      | 'edit'
      | 'delete'
      | 'approve'
    )[],
  };

  describe('checkModulePermission', () => {
    it('returns true when module is active and action is granted', () => {
      expect(checkModulePermission([crmModule], 'crm', 'view')).toBe(true);
    });

    it('returns false when action is not in role snapshot', () => {
      expect(checkModulePermission([crmModule], 'crm', 'delete')).toBe(false);
    });

    it('returns false when module is inactive', () => {
      expect(
        checkModulePermission([{ ...crmModule, isActive: false }], 'crm', 'view'),
      ).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('allows product module action when module is ACTIVE in snapshot', () => {
      expect(
        checkPermission(
          { modules: [crmModule], subscriptionStatus: 'active' },
          'crm',
          'view',
        ),
      ).toBe(true);
    });

    it('denies when subscription is active but module missing from snapshot', () => {
      expect(
        checkPermission({ modules: [], subscriptionStatus: 'active' }, 'crm', 'view'),
      ).toBe(false);
    });

    it('denies when module is inactive in snapshot', () => {
      expect(
        checkPermission(
          {
            modules: [{ ...crmModule, isActive: false }],
            subscriptionStatus: 'active',
          },
          'crm',
          'view',
        ),
      ).toBe(false);
    });
  });

  describe('checkPermissionCode', () => {
    it('grants all permissions for super_admin', () => {
      const user = makeUser({ role: 'super_admin', permissions: [] });
      expect(checkPermissionCode(user, 'customers:read')).toBe(true);
    });

    it('maps legacy customers:read to crm view via subscription snapshot', () => {
      const user = makeUser({
        permissions: ['customers:read'],
        modules: [crmModule],
        subscriptionStatus: 'active',
      });
      expect(checkPermissionCode(user, 'customers:read')).toBe(true);
    });

    it('denies legacy product permission when module action missing', () => {
      const user = makeUser({
        permissions: ['customers:read'],
        modules: [{ ...crmModule, permissions: [] }],
        subscriptionStatus: 'active',
      });
      expect(checkPermissionCode(user, 'customers:read')).toBe(false);
    });

    it('checks admin module permission without subscription gate', () => {
      const user = makeUser({
        permissions: ['users:view'],
        modules: [],
        subscriptionStatus: 'none',
      });
      expect(checkPermissionCode(user, 'users:view')).toBe(true);
    });

    it('denies when flat permission list does not include code', () => {
      const user = makeUser({
        permissions: [],
        modules: [crmModule],
        subscriptionStatus: 'active',
      });
      expect(checkPermissionCode(user, 'users:view')).toBe(false);
    });

    it('accepts platform-owner plans:view as subscription_plans:view', () => {
      const user = makeUser({
        role: 'PLATFORM_OWNER',
        permissions: ['plans:view', 'modules:view'],
      });
      expect(checkPermissionCode(user, 'subscription_plans:view')).toBe(true);
      expect(checkPermissionCode(user, 'subscription_modules:view')).toBe(true);
    });
  });

  describe('supply-chain resource permissions (vendors / items)', () => {
    const vendorStaff = makeUser({
      role: 'VENDOR',
      companyId: '15',
      permissions: ['vendors:view'],
      modules: [{ ...supplyChainModule, permissions: ['view'] }],
      subscriptionStatus: 'active',
    });

    const vendorManager = makeUser({
      role: 'VENDOR',
      companyId: '15',
      permissions: [
        'vendors:view',
        'vendors:create',
        'vendors:edit',
        'vendors:approve',
      ],
      modules: [
        {
          ...supplyChainModule,
          permissions: ['view', 'create', 'edit', 'approve'],
        },
      ],
      subscriptionStatus: 'active',
    });

    const itemStaff = makeUser({
      role: 'INVENTORY_ADMIN',
      companyId: '15',
      permissions: ['items:view'],
      modules: [{ ...supplyChainModule, permissions: ['view'] }],
      subscriptionStatus: 'active',
    });

    it('1–5 Vendor Staff: view only on Vendors', () => {
      expect(checkPermissionCode(vendorStaff, 'vendors:view')).toBe(true);
      expect(checkPermissionCode(vendorStaff, 'vendors:create')).toBe(false);
      expect(checkPermissionCode(vendorStaff, 'vendors:edit')).toBe(false);
      expect(checkPermissionCode(vendorStaff, 'vendors:delete')).toBe(false);
      expect(checkPermissionCode(vendorStaff, 'vendors:approve')).toBe(false);
    });

    it('6 Vendor Staff cannot view Items without items:view', () => {
      expect(checkPermissionCode(vendorStaff, 'items:view')).toBe(false);
    });

    it('7–8 Item Staff can view Items but not Vendors', () => {
      expect(checkPermissionCode(itemStaff, 'items:view')).toBe(true);
      expect(checkPermissionCode(itemStaff, 'vendors:view')).toBe(false);
    });

    it('9 Vendor Manager can create/edit/approve Vendors', () => {
      expect(checkPermissionCode(vendorManager, 'vendors:create')).toBe(true);
      expect(checkPermissionCode(vendorManager, 'vendors:edit')).toBe(true);
      expect(checkPermissionCode(vendorManager, 'vendors:approve')).toBe(true);
    });

    it('10 Vendor Manager cannot modify Items without item permissions', () => {
      expect(checkPermissionCode(vendorManager, 'items:edit')).toBe(false);
      expect(checkPermissionCode(vendorManager, 'items:create')).toBe(false);
    });

    it('11 denies product resource when supply-chain module not entitled', () => {
      const user = makeUser({
        permissions: ['vendors:view'],
        modules: [],
        subscriptionStatus: 'active',
      });
      expect(checkPermissionCode(user, 'vendors:view')).toBe(false);
    });

    it('12 effective codes: legacy supply-chain:view aliases to both resources', () => {
      const user = makeUser({
        permissions: ['supply-chain:view'],
        modules: [{ ...supplyChainModule, permissions: ['view'] }],
        subscriptionStatus: 'active',
      });
      expect(checkPermissionCode(user, 'vendors:view')).toBe(true);
      expect(checkPermissionCode(user, 'items:view')).toBe(true);
    });

    it('maps legacy vendors:read / products:read to resource codes', () => {
      const user = makeUser({
        permissions: ['vendors:view', 'items:view'],
        modules: [{ ...supplyChainModule, permissions: ['view'] }],
        subscriptionStatus: 'active',
      });
      expect(checkPermissionCode(user, 'vendors:read')).toBe(true);
      expect(checkPermissionCode(user, 'products:read')).toBe(true);
    });
  });
});
