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
    it('allows product module action when subscription is active', () => {
      expect(
        checkPermission(
          { modules: [crmModule], subscriptionStatus: 'active' },
          'crm',
          'view',
        ),
      ).toBe(true);
    });

    it('allows product module action when subscription is trial', () => {
      expect(
        checkPermission(
          { modules: [crmModule], subscriptionStatus: 'trial' },
          'crm',
          'view',
        ),
      ).toBe(true);
    });

    it('denies when subscription is none and module is not in snapshot', () => {
      expect(
        checkPermission({ modules: [], subscriptionStatus: 'none' }, 'crm', 'view'),
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
        permissions: ['users:read'],
        modules: [],
        subscriptionStatus: 'none',
      });
      expect(checkPermissionCode(user, 'users:read')).toBe(true);
    });

    it('denies when flat permission list does not include code', () => {
      const user = makeUser({
        permissions: [],
        modules: [crmModule],
        subscriptionStatus: 'active',
      });
      expect(checkPermissionCode(user, 'users:read')).toBe(false);
    });
  });
});
