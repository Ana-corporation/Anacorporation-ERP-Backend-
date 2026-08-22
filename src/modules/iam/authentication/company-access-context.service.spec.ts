import { CompanyAccessContextService } from './company-access-context.service';
import { CompanyAccessContextRepository } from './company-access-context.repository';

describe('CompanyAccessContextService — supply-chain resource roles', () => {
  const supplyChainModuleId = 11n;
  const supplyChainModule = {
    moduleId: supplyChainModuleId,
    moduleCode: 'supply-chain',
    moduleName: 'Supply Chain',
    moduleType: 'product',
  };

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
      findProductModules: jest.fn().mockResolvedValue([
        {
          moduleId: supplyChainModuleId,
          moduleCode: 'supply-chain',
          moduleName: 'Supply Chain',
          lifecycleStatus: 'AVAILABLE',
        },
      ]),
    } as unknown as CompanyAccessContextRepository;

    return { service: new CompanyAccessContextService(repository), repository };
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
      userId: '1',
      companyId: '15',
      entitledModuleIds: [supplyChainModuleId],
      companyModuleActiveById: new Map([[supplyChainModuleId.toString(), true]]),
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
    expect(modules[0].lifecycleStatus).toBe('AVAILABLE');
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
      userId: '1',
      companyId: '15',
      entitledModuleIds: [supplyChainModuleId],
      companyModuleActiveById: new Map([[supplyChainModuleId.toString(), true]]),
      roleId: 99n,
      overrides: [],
    });

    expect(modules[0].permissions).toEqual(expect.arrayContaining(['view', 'create']));
  });
});
