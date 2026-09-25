import { TabAccessService } from './tab-access.service';
import { TabAccessRepository } from './tab-access.repository';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  mapSectionKeyToTabKey,
  normalizeTabKey,
  getTabRegistry,
} from './tab-registry';

describe('tab-registry', () => {
  it('exposes canonical vendor tabKeys including attachments + custom', () => {
    const keys = getTabRegistry('vendor').map((t) => t.tabKey);
    expect(keys).toEqual([
      'general',
      'payment',
      'bank',
      'paymentRun',
      'accounting',
      'remarks',
      'attachments',
      'custom',
    ]);
  });

  it('maps contact/address sections to general tab', () => {
    expect(mapSectionKeyToTabKey('vendor', 'contact')).toBe('general');
    expect(mapSectionKeyToTabKey('vendor', 'address')).toBe('general');
    expect(mapSectionKeyToTabKey('vendor', 'payment')).toBe('payment');
  });

  it('normalizes legacy aliases', () => {
    expect(normalizeTabKey('vendor', 'paymentTerms')).toBe('payment');
    expect(normalizeTabKey('vendor', 'payment_run')).toBe('paymentRun');
    expect(normalizeTabKey('vendor', 'General')).toBe('general');
  });
});

describe('TabAccessService.getVisibleTabKeysForUser', () => {
  const companyId = '28';
  const user = {
    sub: '100',
    email: 'staff@test.com',
    sessionId: 's1',
    companyId,
    role: 'STAFF',
    permissions: ['supply-chain:view'],
    modules: [],
    subscriptionStatus: 'active',
    firstName: 'A',
    lastName: 'B',
  } as AuthenticatedUser;

  function makeService(rows: Array<{ tabKey: string; roleId: bigint; isVisible: boolean }>) {
    const repository = {
      findPrimaryUserRole: jest.fn().mockResolvedValue({ roleId: 5n }),
      findAccessRows: jest.fn().mockResolvedValue(rows),
      findCompanyRoles: jest.fn(),
      findRolesByIds: jest.fn(),
      replaceTabAccess: jest.fn(),
    } as unknown as TabAccessRepository;
    return new TabAccessService(repository);
  }

  it('omits tab when role has isVisible=false (empty allow-list semantics)', async () => {
    const service = makeService([
      { tabKey: 'general', roleId: 5n, isVisible: false },
      { tabKey: 'payment', roleId: 5n, isVisible: true },
    ]);
    const visible = await service.getVisibleTabKeysForUser({
      companyId,
      entityType: 'vendor',
      user,
    });
    expect(visible.has('general')).toBe(false);
    expect(visible.has('payment')).toBe(true);
  });

  it('hides tab for role with no row when other roles have overrides', async () => {
    const service = makeService([
      { tabKey: 'accounting', roleId: 1n, isVisible: true },
    ]);
    const visible = await service.getVisibleTabKeysForUser({
      companyId,
      entityType: 'vendor',
      user,
    });
    expect(visible.has('accounting')).toBe(false);
  });
});
