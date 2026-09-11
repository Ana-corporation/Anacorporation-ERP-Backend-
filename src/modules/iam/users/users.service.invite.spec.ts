import { UsersService } from './users.service';

describe('UsersService — invite default ADMIN', () => {
  it('assigns roleCode ADMIN when roleId is omitted', async () => {
    const repository = {
      findCompanyRoleByCode: jest.fn().mockResolvedValue({ roleId: 99n, roleCode: 'ADMIN' }),
      findCompanyRole: jest.fn().mockResolvedValue({ roleId: 99n, roleCode: 'ADMIN' }),
      findByEmail: jest.fn().mockResolvedValue(null),
      findByUsername: jest.fn().mockResolvedValue(null),
      createInvitedUser: jest.fn().mockResolvedValue({ user: { userId: 7n } }),
      isEmployeeCodeTaken: jest.fn().mockResolvedValue(null),
      hasPrimaryAdmin: jest.fn().mockResolvedValue(null),
      findCompanyLoginCode: jest.fn().mockResolvedValue({ companyCode: 'ACME' }),
      assignRole: jest.fn(),
      findCompanyUserDetail: jest.fn().mockResolvedValue({
        userId: 7n,
        username: 'priya',
        displayName: 'Priya Admin',
        email: 'priya@acme.example.com',
        firstName: 'Priya',
        lastName: 'Admin',
        mobile: null,
        isActive: true,
        companies: [
          {
            userCompanyId: 1n,
            employeeId: 'ADMIN001',
            departmentId: null,
            designationId: null,
            branchId: null,
            warehouseId: null,
            status: 'invited',
            isDefault: true,
          },
        ],
        roles: [{ role: { roleId: 99n, roleCode: 'ADMIN', roleName: 'Administrator' } }],
      }),
    };

    const service = new UsersService(
      repository as never,
      { log: jest.fn(), withAudit: jest.fn(async (row) => row) } as never,
      { get: jest.fn().mockReturnValue(24) } as never,
      { invalidate: jest.fn() } as never,
      { ensureLinkedForInvite: jest.fn() } as never,
    );

    await service.invite(
      '15',
      {
        firstName: 'Priya',
        lastName: 'Admin',
        email: 'priya@acme.example.com',
      } as never,
      '1',
    );

    expect(repository.findCompanyRoleByCode).toHaveBeenCalledWith('15', 'ADMIN');
    expect(repository.assignRole).toHaveBeenCalledWith('7', '15', '99', '1');
    expect(repository.createInvitedUser).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'ADMIN001', isPrimaryAdmin: true }),
    );
  });
});
