import { DataAccessPoliciesService } from './data-access-policies.service';

/**
 * Unit tests for WHERE-scope semantics (V1).
 * Repository is mocked — no DB.
 */
describe('DataAccessPoliciesService scope rules', () => {
  const repository = {
    resolveUserDataScope: jest.fn(),
    findByCode: jest.fn(),
  };

  const service = new DataAccessPoliciesService(
    repository as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no assigned policies → unrestricted (isRestricted=false)', async () => {
    repository.resolveUserDataScope.mockResolvedValue([]);
    const scope = await service.resolveUserDataScope('1', '10');
    expect(scope.isRestricted).toBe(false);
    expect(await service.canAccessRecord({ userId: '1', companyId: '10', warehouseId: '99' })).toBe(
      true,
    );
  });

  it('assigned policies → UNION of scopes', async () => {
    repository.resolveUserDataScope.mockResolvedValue([
      {
        policy: {
          branches: [{ branchId: 1n }],
          departments: [],
          warehouses: [{ warehouseId: 10n }],
        },
      },
      {
        policy: {
          branches: [{ branchId: 2n }],
          departments: [{ departmentId: 5n }],
          warehouses: [{ warehouseId: 20n }],
        },
      },
    ]);

    const scope = await service.resolveUserDataScope('1', '10');
    expect(scope.isRestricted).toBe(true);
    expect(scope.branchIds.sort()).toEqual(['1', '2']);
    expect(scope.departmentIds).toEqual(['5']);
    expect(scope.warehouseIds.sort()).toEqual(['10', '20']);
  });

  it('empty policy scopes → restricted but no ids → DENY warehouse', async () => {
    repository.resolveUserDataScope.mockResolvedValue([
      { policy: { branches: [], departments: [], warehouses: [] } },
    ]);

    const scope = await service.resolveUserDataScope('1', '10');
    expect(scope.isRestricted).toBe(true);
    expect(scope.warehouseIds).toEqual([]);
    expect(
      await service.canAccessRecord({ userId: '1', companyId: '10', warehouseId: '10' }),
    ).toBe(false);
  });

  it('permission-scope split: in-scope warehouse ALLOW, out-of-scope DENY', async () => {
    repository.resolveUserDataScope.mockResolvedValue([
      {
        policy: {
          branches: [{ branchId: 1n }],
          departments: [],
          warehouses: [{ warehouseId: 10n }],
        },
      },
    ]);

    expect(
      await service.canAccessRecord({ userId: '1', companyId: '10', warehouseId: '10' }),
    ).toBe(true);
    expect(
      await service.canAccessRecord({ userId: '1', companyId: '10', warehouseId: '99' }),
    ).toBe(false);
    expect(
      await service.canAccessRecord({
        userId: '1',
        companyId: '10',
        branchId: '1',
        warehouseId: '10',
      }),
    ).toBe(true);
    expect(
      await service.canAccessRecord({
        userId: '1',
        companyId: '10',
        branchId: '2',
        warehouseId: '10',
      }),
    ).toBe(false);
  });

  it('resolveUniqueCode returns requested when free', async () => {
    repository.findByCode.mockResolvedValue(null);
    await expect(service.resolveUniqueCode('10', 'PURCHASE_CHENNAI_ACCESS')).resolves.toBe(
      'PURCHASE_CHENNAI_ACCESS',
    );
  });

  it('resolveUniqueCode appends _2 when base taken', async () => {
    repository.findByCode.mockImplementation(async (_companyId: string, code: string) =>
      code === 'PURCHASE_CHENNAI_ACCESS' ? { policyId: 1n } : null,
    );
    await expect(service.resolveUniqueCode('10', 'PURCHASE_CHENNAI_ACCESS')).resolves.toBe(
      'PURCHASE_CHENNAI_ACCESS_2',
    );
  });

  it('resolveUniqueCode appends _3 when base and _2 taken', async () => {
    repository.findByCode.mockImplementation(async (_companyId: string, code: string) =>
      code === 'PURCHASE_CHENNAI_ACCESS' || code === 'PURCHASE_CHENNAI_ACCESS_2'
        ? { policyId: 1n }
        : null,
    );
    await expect(service.resolveUniqueCode('10', 'purchase_chennai_access')).resolves.toBe(
      'PURCHASE_CHENNAI_ACCESS_3',
    );
  });
});
