import { ForbiddenException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from './company-access.util';

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

describe('assertCompanyAccess', () => {
  it('allows a tenant user when path company matches JWT companyId', () => {
    expect(() => assertCompanyAccess('15', makeUser({ companyId: '15' }))).not.toThrow();
  });

  it('rejects a tenant user targeting another company', () => {
    expect(() => assertCompanyAccess('99', makeUser({ companyId: '15' }))).toThrow(ForbiddenException);
  });

  it('allows platform owner with no JWT companyId', () => {
    expect(() => assertCompanyAccess('15', makeUser({ companyId: undefined }))).not.toThrow();
  });

  it('allows platform_companies:view across tenants', () => {
    expect(() =>
      assertCompanyAccess(
        '99',
        makeUser({ companyId: '1', permissions: ['platform_companies:view'] }),
      ),
    ).not.toThrow();
  });
});
