import { EntitlementService } from './entitlement.service';

describe('EntitlementService', () => {
  const repository = {
    findCompany: jest.fn(),
    findLiveSubscription: jest.fn(),
    findPlanModuleIds: jest.fn(),
    findActiveOverrides: jest.fn(),
    findCompanyModuleSettings: jest.fn(),
    findProductModulesByIds: jest.fn(),
    findAllTenantProductModules: jest.fn(),
  };

  const service = new EntitlementService(repository as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('entitles plan modules by default', async () => {
    repository.findCompany.mockResolvedValue({ status: 'active' });
    repository.findLiveSubscription.mockResolvedValue({
      status: 'active',
      plan: { planCode: 'pro', name: 'Professional' },
      startDate: new Date('2026-01-01'),
      endDate: new Date('2027-01-01'),
      autoRenew: true,
      cancelAtPeriodEnd: false,
      planId: 1n,
    });
    repository.findPlanModuleIds.mockResolvedValue([{ moduleId: 10n }]);
    repository.findActiveOverrides.mockResolvedValue([]);
    repository.findCompanyModuleSettings.mockResolvedValue([]);
    repository.findAllTenantProductModules.mockResolvedValue([
      {
        moduleId: 10n,
        moduleCode: 'supply-chain',
        moduleName: 'Supply Chain',
        lifecycleStatus: 'AVAILABLE',
      },
    ]);
    repository.findProductModulesByIds.mockResolvedValue([
      {
        moduleId: 10n,
        moduleCode: 'supply-chain',
        moduleName: 'Supply Chain',
        lifecycleStatus: 'AVAILABLE',
      },
    ]);

    const result = await service.getEffectiveEntitlements('5');
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]).toMatchObject({
      code: 'supply-chain',
      entitled: true,
      enabled: true,
      effectiveAccess: true,
      source: 'PLAN',
      planIncluded: true,
    });
  });

  it('applies GRANT override and REVOKE override', async () => {
    repository.findCompany.mockResolvedValue({ status: 'active' });
    repository.findLiveSubscription.mockResolvedValue({
      status: 'active',
      plan: { planCode: 'pro', name: 'Professional' },
      startDate: new Date('2026-01-01'),
      endDate: null,
      autoRenew: true,
      cancelAtPeriodEnd: false,
      planId: 1n,
    });
    repository.findPlanModuleIds.mockResolvedValue([{ moduleId: 10n }]);
    repository.findActiveOverrides.mockResolvedValue([
      {
        moduleId: 11n,
        action: 'GRANT',
        module: {
          moduleId: 11n,
          moduleCode: 'manufacturing',
          moduleName: 'Manufacturing',
          moduleType: 'product',
          lifecycleStatus: 'AVAILABLE',
          deletedAt: null,
        },
      },
      {
        moduleId: 10n,
        action: 'REVOKE',
        module: {
          moduleId: 10n,
          moduleCode: 'supply-chain',
          moduleName: 'Supply Chain',
          moduleType: 'product',
          lifecycleStatus: 'AVAILABLE',
          deletedAt: null,
        },
      },
    ]);
    repository.findCompanyModuleSettings.mockResolvedValue([]);
    repository.findAllTenantProductModules.mockResolvedValue([
      {
        moduleId: 10n,
        moduleCode: 'supply-chain',
        moduleName: 'Supply Chain',
        lifecycleStatus: 'AVAILABLE',
      },
      {
        moduleId: 11n,
        moduleCode: 'manufacturing',
        moduleName: 'Manufacturing',
        lifecycleStatus: 'AVAILABLE',
      },
    ]);
    repository.findProductModulesByIds.mockResolvedValue([
      {
        moduleId: 11n,
        moduleCode: 'manufacturing',
        moduleName: 'Manufacturing',
        lifecycleStatus: 'AVAILABLE',
      },
    ]);

    const result = await service.getEffectiveEntitlements('5');
    expect(result.modules.find((m) => m.code === 'manufacturing')).toMatchObject({
      entitled: true,
      source: 'GRANT',
    });
    expect(result.modules.find((m) => m.code === 'supply-chain')).toMatchObject({
      entitled: false,
      source: 'NONE',
    });
  });
});
