import {
  resolveCompanySystemTemplates,
  SYSTEM_ROLE_TEMPLATES,
} from './system-role-templates';

describe('system-role-templates', () => {
  it('never includes PLATFORM_OWNER for company resolution', () => {
    const keys = resolveCompanySystemTemplates(['crm', 'supply-chain']).map((t) => t.templateKey);
    expect(keys).not.toContain('PLATFORM_OWNER');
  });

  it('always includes core company templates', () => {
    const keys = resolveCompanySystemTemplates([]).map((t) => t.templateKey);
    expect(keys).toEqual(expect.arrayContaining(['ADMIN', 'MANAGER', 'STAFF']));
    expect(keys).not.toContain('SALES');
    expect(keys).not.toContain('VENDOR');
    expect(keys).not.toContain('INVENTORY_ADMIN');
  });

  it('adds SALES when crm entitled', () => {
    const keys = resolveCompanySystemTemplates(['crm']).map((t) => t.templateKey);
    expect(keys).toContain('SALES');
    expect(keys).not.toContain('VENDOR');
  });

  it('adds VENDOR and INVENTORY_ADMIN when supply-chain entitled', () => {
    const keys = resolveCompanySystemTemplates(['supply-chain']).map((t) => t.templateKey);
    expect(keys).toEqual(
      expect.arrayContaining(['ADMIN', 'MANAGER', 'STAFF', 'VENDOR', 'INVENTORY_ADMIN']),
    );
  });

  it('registry templateKeys are unique', () => {
    const keys = SYSTEM_ROLE_TEMPLATES.map((t) => t.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
