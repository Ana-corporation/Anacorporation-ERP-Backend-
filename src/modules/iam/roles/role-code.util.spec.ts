import {
  allocateUniqueRoleCode,
  isReservedRoleCode,
  normalizeRoleCodeBase,
} from './role-code.util';

describe('role-code.util', () => {
  it('normalizes role names to UPPER_SNAKE', () => {
    expect(normalizeRoleCodeBase('Purchase Approver')).toBe('PURCHASE_APPROVER');
    expect(normalizeRoleCodeBase('  a--b__c  ')).toBe('A_B_C');
    expect(normalizeRoleCodeBase('@@@')).toBe('ROLE');
  });

  it('detects reserved codes', () => {
    expect(isReservedRoleCode('ADMIN')).toBe(true);
    expect(isReservedRoleCode('purchase_approver')).toBe(false);
  });

  it('allocates unique suffix when taken', async () => {
    const taken = new Set(['PURCHASE_APPROVER', 'PURCHASE_APPROVER_2']);
    const code = await allocateUniqueRoleCode({
      preferredBase: 'Purchase Approver',
      isTaken: async (c) => taken.has(c),
    });
    expect(code).toBe('PURCHASE_APPROVER_3');
  });
});
