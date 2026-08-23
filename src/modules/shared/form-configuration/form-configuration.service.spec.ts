import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '@/common/exceptions/business.exception';
import { FormConfigurationService } from './form-configuration.service';
import { FormConfigurationRepository } from './form-configuration.repository';
import { getBuiltInField } from './built-in-field-registry';

describe('FormConfigurationService', () => {
  const companyId = '15';

  function makeService(overrides: Partial<FormConfigurationRepository> = {}) {
    const repository = {
      findOverrides: jest.fn().mockResolvedValue([]),
      upsertOverride: jest.fn(),
      deleteOverride: jest.fn(),
      deleteAllOverrides: jest.fn(),
      ...overrides,
    } as unknown as FormConfigurationRepository;

    return { service: new FormConfigurationService(repository), repository };
  }

  it('returns ERP defaults when no overrides exist', async () => {
    const { service } = makeService();
    const result = await service.getConfiguration(companyId, 'vendor');
    const website = result.sections
      .flatMap((s: { fields: { fieldKey: string; visible: boolean }[] }) => s.fields)
      .find((f: { fieldKey: string }) => f.fieldKey === 'website');
    expect(website?.visible).toBe(true);
  });

  it('rejects hiding protected vendorName', async () => {
    const { service } = makeService();
    try {
      await service.updateConfiguration(companyId, 'vendor', {
        fields: [{ fieldKey: 'vendorName', isVisible: false }],
      });
      fail('expected BusinessException');
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessException);
      expect((err as BusinessException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((err as BusinessException).getResponse()).toMatchObject({
        code: 'PROTECTED_FIELD_CANNOT_HIDE',
      });
    }
  });

  it('deletes override when visibility matches ERP default', async () => {
    const { service, repository } = makeService();
    await service.updateConfiguration(companyId, 'vendor', {
      fields: [{ fieldKey: 'website', isVisible: true }],
    });
    expect(repository.deleteOverride).toHaveBeenCalledWith(companyId, 'vendor', 'website');
    expect(repository.upsertOverride).not.toHaveBeenCalled();
  });

  it('upserts override when visibility differs from default', async () => {
    const { service, repository } = makeService();
    await service.updateConfiguration(companyId, 'vendor', {
      fields: [{ fieldKey: 'website', isVisible: false }],
    });
    expect(repository.upsertOverride).toHaveBeenCalledWith(
      companyId,
      'vendor',
      'website',
      false,
    );
  });

  it('reset removes all overrides', async () => {
    const { service, repository } = makeService();
    await service.resetConfiguration(companyId, 'vendor');
    expect(repository.deleteAllOverrides).toHaveBeenCalledWith(companyId, 'vendor');
  });

  it('maps vendorName to core name storage', () => {
    const field = getBuiltInField('vendor', 'vendorName');
    expect(field?.storage).toEqual({ kind: 'core', apiKey: 'name' });
  });

  it('returns item ERP defaults with header + purchasing sections', async () => {
    const { service } = makeService();
    const result = await service.getConfiguration(companyId, 'item');
    expect(result.entityType).toBe('item');
    const sectionKeys = result.sections.map((s: { sectionKey: string }) => s.sectionKey);
    expect(sectionKeys).toEqual(
      expect.arrayContaining(['header', 'general', 'purchasing', 'sales', 'inventory']),
    );
    const itemCode = result.sections
      .flatMap((s: { fields: { fieldKey: string; configurable: boolean }[] }) => s.fields)
      .find((f: { fieldKey: string }) => f.fieldKey === 'itemCode');
    expect(itemCode?.configurable).toBe(false);
  });

  it('rejects hiding protected itemCode', async () => {
    const { service } = makeService();
    try {
      await service.updateConfiguration(companyId, 'item', {
        fields: [{ fieldKey: 'itemCode', isVisible: false }],
      });
      fail('expected BusinessException');
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessException);
      expect((err as BusinessException).getResponse()).toMatchObject({
        code: 'PROTECTED_FIELD_CANNOT_HIDE',
      });
    }
  });

  it('upserts item bag field override', async () => {
    const { service, repository } = makeService();
    await service.updateConfiguration(companyId, 'item', {
      fields: [{ fieldKey: 'purchase.weight', isVisible: false }],
    });
    expect(repository.upsertOverride).toHaveBeenCalledWith(
      companyId,
      'item',
      'purchase.weight',
      false,
    );
  });

  it('rejects unknown item fieldKey', async () => {
    const { service } = makeService();
    try {
      await service.updateConfiguration(companyId, 'item', {
        fields: [{ fieldKey: 'notARealField', isVisible: false }],
      });
      fail('expected BusinessException');
    } catch (err) {
      expect((err as BusinessException).getResponse()).toMatchObject({
        code: 'INVALID_FIELD_KEY',
      });
    }
  });

  it('reset item only deletes item overrides', async () => {
    const { service, repository } = makeService();
    await service.resetConfiguration(companyId, 'item');
    expect(repository.deleteAllOverrides).toHaveBeenCalledWith(companyId, 'item');
    expect(repository.deleteAllOverrides).not.toHaveBeenCalledWith(companyId, 'vendor');
  });

  it('rejects unsupported entity type', async () => {
    const { service } = makeService();
    try {
      await service.getConfiguration(companyId, 'customer');
      fail('expected BusinessException');
    } catch (err) {
      expect((err as BusinessException).getResponse()).toMatchObject({
        code: 'ENTITY_TYPE_NOT_SUPPORTED',
      });
    }
  });
});
