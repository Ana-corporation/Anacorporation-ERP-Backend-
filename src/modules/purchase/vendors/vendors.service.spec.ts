import { VendorsService } from './vendors.service';
import { VendorsRepository } from './vendors.repository';
import { CustomFieldsValuesService } from '@/modules/shared/custom-fields/custom-fields.service';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

describe('VendorsService — metadata merge', () => {
  it('merges metadata on update so hidden fields retain values', async () => {
    const existing = {
      vendorId: 1n,
      companyId: 15n,
      metadata: { website: 'https://abc.com', paymentTerms: 'Net30' },
    };

    const repository = {
      findById: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue(existing),
    } as unknown as VendorsRepository;

    const customFieldsValuesService = {
      mergeEntityWithCustomFields: jest.fn().mockResolvedValue(existing),
    } as unknown as CustomFieldsValuesService;

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn({})),
    } as unknown as PrismaService;

    const service = new VendorsService(
      repository,
      { log: jest.fn() } as unknown as AuditService,
      prisma,
      customFieldsValuesService,
    );

    await service.update('1', '15', { metadata: { paymentTerms: 'Net60' } }, '99');

    expect(repository.update).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        metadata: { website: 'https://abc.com', paymentTerms: 'Net60' },
      }),
      '99',
      expect.anything(),
    );
  });
});
