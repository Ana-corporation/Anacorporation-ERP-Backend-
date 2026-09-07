import { companyCodeCandidates, slugCompanyCodeFromName } from './company-code.util';

describe('company-code.util', () => {
  it('slugs a display name to a valid companyCode', () => {
    expect(slugCompanyCodeFromName('Acme Trading')).toBe('ACME_TRADING');
  });

  it('offers name slug then numbered then CO-sequence', () => {
    const codes = companyCodeCandidates('Acme Trading', 1);
    expect(codes[0]).toBe('ACME_TRADING');
    expect(codes[1]).toBe('ACME_TRADING_2');
    expect(codes[codes.length - 1]).toBe('CO-000001');
  });
});
