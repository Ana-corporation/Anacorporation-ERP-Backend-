import { CreateCompanySchema, UpdateCompanySchema } from './company.dto';

describe('Company DTOs — Phase 1 create contract', () => {
  it('normalizes companyCode to uppercase and requires country', () => {
    const parsed = CreateCompanySchema.parse({
      name: 'Acme Trading',
      companyCode: ' acme ',
      country: ' India ',
    });
    expect(parsed.companyCode).toBe('ACME');
    expect(parsed.country).toBe(' India '.trim());
    expect(parsed.status).toBeUndefined();
  });

  it('allows omitting companyCode (BE auto-generates)', () => {
    const parsed = CreateCompanySchema.parse({
      name: 'Acme Trading',
      country: 'India',
    });
    expect(parsed.companyCode).toBeUndefined();
  });

  it('rejects invalid companyCode characters', () => {
    const result = CreateCompanySchema.safeParse({
      name: 'Acme Trading',
      companyCode: 'acme@123',
      country: 'India',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional status trial|active|suspended|cancelled', () => {
    const parsed = CreateCompanySchema.parse({
      name: 'Acme Trading',
      companyCode: 'ACME',
      country: 'India',
      status: 'trial',
    });
    expect(parsed.status).toBe('trial');
  });

  it('rejects companyCode on update (immutable)', () => {
    const result = UpdateCompanySchema.safeParse({
      name: 'Acme',
      companyCode: 'NEWCODE',
    });
    expect(result.success).toBe(false);
  });

  it('allows country on update', () => {
    const parsed = UpdateCompanySchema.parse({ country: 'Singapore' });
    expect(parsed.country).toBe('Singapore');
  });
});
