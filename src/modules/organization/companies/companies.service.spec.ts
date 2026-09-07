import { ConflictException } from '@/common/exceptions/business.exception';
import { CompaniesService } from './companies.service';

describe('CompaniesService — Phase 1 create', () => {
  it('checks duplicate using uppercase companyCode', async () => {
    const repository = {
      findByCode: jest.fn().mockResolvedValue({ companyId: 1n, companyCode: 'ACME' }),
      create: jest.fn(),
      nextAutoCompanySequence: jest.fn(),
    };
    const service = new CompaniesService(
      repository as never,
      { log: jest.fn() } as never,
      { provisionForCompany: jest.fn() } as never,
    );

    await expect(
      service.create(
        { name: 'Acme', companyCode: 'ACME', country: 'India' } as never,
        '1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repository.findByCode).toHaveBeenCalledWith('ACME');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('auto-generates companyCode from name when omitted', async () => {
    const repository = {
      findByCode: jest.fn().mockResolvedValue(null),
      nextAutoCompanySequence: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue({ companyId: 15n, companyCode: 'ACME_TRADING', name: 'Acme Trading' }),
      findPlatformCompanySummary: jest.fn().mockResolvedValue({
        companyId: 15n,
        companyCode: 'ACME_TRADING',
      }),
    };
    const service = new CompaniesService(
      repository as never,
      { log: jest.fn() } as never,
      { provisionForCompany: jest.fn() } as never,
    );

    await service.create({ name: 'Acme Trading', country: 'India' } as never, '1');

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyCode: 'ACME_TRADING', country: 'India' }),
      '1',
    );
  });
});
