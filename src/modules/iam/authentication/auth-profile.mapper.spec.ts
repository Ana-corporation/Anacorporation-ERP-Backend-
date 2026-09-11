import {
  mapLoginMembership,
  mapLoginUserProfile,
  membershipStatusForFe,
} from './auth-profile.mapper';

describe('auth-profile.mapper', () => {
  it('maps user phone/avatar/employeeCode and falls back displayName', () => {
    const user = mapLoginUserProfile(
      {
        userId: 12n,
        username: 'priya',
        displayName: null,
        firstName: 'Mohana',
        lastName: 'Priya',
        email: 'priya@ana.com',
        mobile: '+91xxxxxxxxxx',
        profilePhoto: 'https://files/avatar.png',
      },
      { employeeId: 'ANA03' },
    );

    expect(user).toEqual({
      userId: '12',
      username: 'priya',
      displayName: 'Mohana Priya',
      email: 'priya@ana.com',
      phone: '+91xxxxxxxxxx',
      avatarUrl: 'https://files/avatar.png',
      employeeCode: 'ANA03',
    });
  });

  it('sends null for unknown membership fields and ACTIVE/INACTIVE status', () => {
    expect(membershipStatusForFe('active')).toBe('ACTIVE');
    expect(membershipStatusForFe('invited')).toBe('INACTIVE');

    expect(
      mapLoginMembership({
        employeeId: 'ANA03',
        status: 'active',
        departmentId: 4n,
        designationId: null,
        warehouseId: 14n,
        department: { name: 'Purchase' },
        designation: null,
        warehouse: { name: 'Main Store' },
      }),
    ).toEqual({
      departmentId: '4',
      departmentName: 'Purchase',
      designationId: null,
      designationName: null,
      warehouseId: '14',
      warehouseName: 'Main Store',
      status: 'ACTIVE',
    });
  });
});
