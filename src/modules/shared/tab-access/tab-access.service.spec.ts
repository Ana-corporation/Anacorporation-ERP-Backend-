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

describe('TabAccessService — registration form per tab', () => {
  const companyId = '28';

  function makeService(savedRows: Array<{ tabKey: string; isRegistrationVisible: boolean }> = []) {
    const repository = {
      findCompanyRoles: jest.fn().mockResolvedValue([]),
      findAccessRows: jest.fn().mockResolvedValue([]),
      findRegistrationSettings: jest.fn().mockResolvedValue(savedRows),
      upsertRegistrationSetting: jest.fn(),
      deleteRegistrationSetting: jest.fn(),
    };
    return {
      service: new TabAccessService(repository as unknown as TabAccessRepository),
      repository,
    };
  }

  type Tab = { tabKey: string; registrationVisible: boolean; registrationConfigurable: boolean };
  const tabsOf = (result: { tabs: Tab[] }) => Object.fromEntries(result.tabs.map((t) => [t.tabKey, t]));

  it('returns the registration option next to each tab (general locked on, attachments switchable)', async () => {
    const { service } = makeService([{ tabKey: 'accounting', isRegistrationVisible: false }]);
    const tabs = tabsOf((await service.getEntityTabs(companyId, 'vendor')) as { tabs: Tab[] });

    expect(tabs.accounting).toMatchObject({ registrationVisible: false, registrationConfigurable: true });
    expect(tabs.bank).toMatchObject({ registrationVisible: true, registrationConfigurable: true });
    expect(tabs.general).toMatchObject({ registrationVisible: true, registrationConfigurable: false });
    expect(tabs.attachments).toMatchObject({ registrationVisible: true, registrationConfigurable: true });
  });

  it('lets the attachments tab be switched off for registration', async () => {
    const { service, repository } = makeService();
    await service.updateTabRegistration(companyId, 'vendor', 'attachments', { isRegistrationVisible: false });
    expect(repository.upsertRegistrationSetting).toHaveBeenCalledWith(companyId, 'vendor', 'attachments', false);
  });

  it('stores "off" and deletes the row when switched back on', async () => {
    const { service, repository } = makeService();

    await service.updateTabRegistration(companyId, 'vendor', 'accounting', { isRegistrationVisible: false });
    expect(repository.upsertRegistrationSetting).toHaveBeenCalledWith(companyId, 'vendor', 'accounting', false);

    await service.updateTabRegistration(companyId, 'vendor', 'accounting', { isRegistrationVisible: true });
    expect(repository.deleteRegistrationSetting).toHaveBeenCalledWith(companyId, 'vendor', 'accounting');
  });

  it('rejects changing a locked tab', async () => {
    const { service, repository } = makeService();
    await expect(
      service.updateTabRegistration(companyId, 'vendor', 'general', { isRegistrationVisible: false }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TAB_REGISTRATION_NOT_CONFIGURABLE' }),
    });
    expect(repository.upsertRegistrationSetting).not.toHaveBeenCalled();
  });

  it('maps contact/address sections to the general tab for the section filter', async () => {
    const { service } = makeService([{ tabKey: 'payment', isRegistrationVisible: false }]);
    const isRegistrationTab = await service.getRegistrationSectionFilter(companyId, 'vendor');

    expect(isRegistrationTab('contact')).toBe(true);
    expect(isRegistrationTab('payment')).toBe(false);
    expect(isRegistrationTab('accounting')).toBe(true);
  });
});
