import { CompanyAccessContextService } from './company-access-context.service';
import { CompanyAccessContextRepository } from './company-access-context.repository';
import { EntitlementService } from '@/modules/subscription/entitlements/entitlement.service';

describe('CompanyAccessContextService — supply-chain resource roles', () => {
  const supplyChainModuleId = 11n;
  const supplyChainModule = {
    moduleId: supplyChainModuleId,
    moduleCode: 'supply-chain',
    moduleName: 'Supply Chain',
    moduleType: 'product',
  };

  function makeEntitlements(enabled = true) {
    return {
      companyId: '15',
      companyStatus: 'active',
      isCustom: false,
      subscription: {
        status: 'active',
        planCode: 'pro',
        planName: 'Professional',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        autoRenew: true,
        cancelAtPeriodEnd: false,
        isValid: true,
      },
      modules: [
        {
          moduleId: supplyChainModuleId.toString(),
          code: 'supply-chain',
          name: 'Supply Chain',
          lifecycleStatus: 'AVAILABLE',
          entitled: true,
          enabled,
          effectiveAccess: enabled,
        },
      ],
    };
  }

  function makeService(overrides: {
    rolePermissions?: Array<{
      permission: { permissionCode: string; action: string };
      module: { moduleType: string; moduleCode: string };
      moduleId: bigint;
    }>;
    overrides?: Array<{
      accessType: string;
      moduleId: bigint;
      module: { moduleType: string; moduleCode: string };
    }>;
    entitlementsEnabled?: boolean;
  }) {
    const repository = {
      findMembership: jest.fn(),
      findUserCompanies: jest.fn(),
      findActiveSubscription: jest.fn(),
      findPrimaryUserRole: jest.fn(),
      countActiveUserRoles: jest.fn(),
      findUserModuleAccess: jest.fn().mockResolvedValue(overrides.overrides ?? []),
      findPlanModuleIds: jest.fn(),
      findCompanyModules: jest.fn(),
      findRolePermissionsByModule: jest.fn().mockResolvedValue(overrides.rolePermissions ?? []),
      findProductModules: jest.fn(),
    } as unknown as CompanyAccessContextRepository;

    const entitlementService = {
      getEffectiveEntitlements: jest.fn(),
    } as unknown as EntitlementService;

    return {
      service: new CompanyAccessContextService(repository, entitlementService),
      repository,
    };
  }

  it('includes supply-chain when role has vendors:view despite deny override', async () => {
    const { service } = makeService({
      rolePermissions: [
        {
          permission: { permissionCode: 'vendors:view', action: 'view' },
          module: supplyChainModule,
          moduleId: supplyChainModuleId,
        },
      ],
      overrides: [
        {
          accessType: 'deny',
          moduleId: supplyChainModuleId,
          module: supplyChainModule,
        },
      ],
    });

    const modules = await (service as any).buildModuleSnapshot({
      entitlements: makeEntitlements(),
      roleId: 99n,
      overrides: [
        {
          accessType: 'deny',
          moduleId: supplyChainModuleId,
          module: supplyChainModule,
        },
      ],
    });

    expect(modules).toHaveLength(1);
    expect(modules[0].moduleCode).toBe('supply-chain');
    expect(modules[0].permissions).toContain('view');
    expect(modules[0].effectiveAccess).toBe(true);
  });

  it('maps items:create to supply-chain module permissions', async () => {
    const { service } = makeService({
      rolePermissions: [
        {
          permission: { permissionCode: 'items:create', action: 'create' },
          module: supplyChainModule,
          moduleId: supplyChainModuleId,
        },
        {
          permission: { permissionCode: 'items:view', action: 'view' },
          module: supplyChainModule,
          moduleId: supplyChainModuleId,
        },
      ],
    });

    const modules = await (service as any).buildModuleSnapshot({
      entitlements: makeEntitlements(),
      roleId: 99n,
      overrides: [],
    });

    expect(modules[0].permissions).toEqual(expect.arrayContaining(['view', 'create']));
  });

  it('sets effectiveAccess false when module disabled in settings', async () => {
    const { service } = makeService({
      rolePermissions: [
        {
          permission: { permissionCode: 'vendors:view', action: 'view' },
          module: supplyChainModule,
          moduleId: supplyChainModuleId,
        },
      ],
    });

    const modules = await (service as any).buildModuleSnapshot({
      entitlements: makeEntitlements(false),
      roleId: 99n,
      overrides: [],
    });

    expect(modules[0].entitled).toBe(true);
    expect(modules[0].enabled).toBe(false);
    expect(modules[0].effectiveAccess).toBe(false);
  });

  it('includes entitled product modules for company ADMIN with no product RolePermissions', async () => {
    const { service } = makeService({ rolePermissions: [] });

    const modules = await (service as any).buildModuleSnapshot({
      entitlements: makeEntitlements(),
      roleId: 99n,
      isCompanyAdmin: true,
      overrides: [],
    });

    expect(modules).toHaveLength(1);
    expect(modules[0].moduleCode).toBe('supply-chain');
    expect(modules[0].permissions).toEqual(
      expect.arrayContaining(['view', 'create', 'edit', 'delete', 'approve']),
    );
  });

  it('still omits entitled modules for non-admin when RolePermissions empty', async () => {
    const { service } = makeService({ rolePermissions: [] });

    const modules = await (service as any).buildModuleSnapshot({
      entitlements: makeEntitlements(),
      roleId: 99n,
      isCompanyAdmin: false,
      overrides: [],
    });

    expect(modules).toHaveLength(0);
  });
});
