import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '@/common/exceptions/business.exception';
import { FormConfigurationService } from './form-configuration.service';
import { FormConfigurationRepository } from './form-configuration.repository';
import { getBuiltInField } from './built-in-field-registry';
import { TabAccessService } from '../tab-access/tab-access.service';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
import { AuditService } from '@/infrastructure/audit/audit.service';

describe('FormConfigurationService', () => {
  const companyId = '15';

  function makeService(
    overrides: Partial<FormConfigurationRepository> = {},
    registrationHiddenSections: string[] = [],
    customDefs: Array<Record<string, unknown>> = [],
  ) {
    const repository = {
      findOverrides: jest.fn().mockResolvedValue([]),
      upsertOverride: jest.fn(),
      deleteOverride: jest.fn(),
      clearVisibilityOverride: jest.fn(),
      deleteAllOverrides: jest.fn(),
      saveFieldOrder: jest.fn(),
      ...overrides,
    } as unknown as FormConfigurationRepository;
    const tabAccessService = {
      getRegistrationSectionFilter: jest
        .fn()
        .mockResolvedValue((sectionKey: string) => !registrationHiddenSections.includes(sectionKey)),
    } as unknown as TabAccessService;
    const customFieldsRepository = {
      findDefinitionsByCompany: jest.fn().mockResolvedValue(customDefs),
    } as unknown as CustomFieldsRepository;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    return {
      service: new FormConfigurationService(
        repository,
        tabAccessService,
        customFieldsRepository,
        auditService,
      ),
      repository,
      auditService,
    };
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
    expect(repository.clearVisibilityOverride).toHaveBeenCalledWith(companyId, 'vendor', 'website');
    expect(repository.upsertOverride).not.toHaveBeenCalled();
  });

  it('upserts override when visibility differs from default', async () => {
    const { service, repository } = makeService();
    await service.updateConfiguration(companyId, 'vendor', {
      fields: [{ fieldKey: 'website', isVisible: false }],
    });
    expect(repository.upsertOverride).toHaveBeenCalledWith(companyId, 'vendor', 'website', {
      isVisible: false,
      isRegistrationVisible: null,
    });
  });

  describe('registration form visibility', () => {
    type Field = {
      fieldKey: string;
      visible: boolean;
      registrationVisible: boolean;
      registrationConfigurable: boolean;
    };
    const fieldsOf = (result: { sections: { fields: Field[] }[] }) =>
      Object.fromEntries(result.sections.flatMap((s) => s.fields).map((f) => [f.fieldKey, f]));

    it('defaults to the Add form visibility and locks staff-only fields', async () => {
      const { service } = makeService({
        findOverrides: jest
          .fn()
          .mockResolvedValue([{ fieldKey: 'fax', isVisible: false, isRegistrationVisible: null }]),
      });
      const byKey = fieldsOf(await service.getConfiguration(companyId, 'vendor'));

      expect(byKey.website).toMatchObject({ registrationVisible: true, registrationConfigurable: true });
      expect(byKey.fax).toMatchObject({ registrationVisible: false, registrationConfigurable: false });
      expect(byKey.vendorName).toMatchObject({ registrationVisible: true, registrationConfigurable: false });
      for (const key of ['supplierCode', 'vendorCategory', 'isActive', 'internalNotes']) {
        expect(byKey[key]).toMatchObject({ registrationVisible: false, registrationConfigurable: false });
      }
    });

    it('stores registration-only overrides without touching Add form visibility', async () => {
      const { service, repository } = makeService();
      await service.updateConfiguration(companyId, 'vendor', {
        fields: [{ fieldKey: 'bankName', isRegistrationVisible: false }],
      });
      expect(repository.upsertOverride).toHaveBeenCalledWith(companyId, 'vendor', 'bankName', {
        isVisible: null,
        isRegistrationVisible: false,
      });
    });

    it('keeps the saved registration value when only isVisible is sent', async () => {
      const { service, repository } = makeService({
        findOverrides: jest
          .fn()
          .mockResolvedValue([{ fieldKey: 'bankName', isVisible: null, isRegistrationVisible: false }]),
      });
      await service.updateConfiguration(companyId, 'vendor', {
        fields: [{ fieldKey: 'bankName', isVisible: true }],
      });
      expect(repository.upsertOverride).toHaveBeenCalledWith(companyId, 'vendor', 'bankName', {
        isVisible: null,
        isRegistrationVisible: false,
      });
    });

    it('ignores isRegistrationVisible on locked fields', async () => {
      const { service, repository } = makeService();
      await service.updateConfiguration(companyId, 'vendor', {
        fields: [
          { fieldKey: 'internalNotes', isRegistrationVisible: true },
          { fieldKey: 'vendorName', isVisible: true, isRegistrationVisible: false },
        ],
      });
      expect(repository.upsertOverride).not.toHaveBeenCalled();
      expect(repository.clearVisibilityOverride).toHaveBeenCalledWith(
        companyId,
        'vendor',
        'internalNotes',
      );
      expect(repository.clearVisibilityOverride).toHaveBeenCalledWith(companyId, 'vendor', 'vendorName');
    });

    it('locks fields inside a tab switched off for registration and ignores writes to them', async () => {
      const { service, repository } = makeService({}, ['bank']);
      const byKey = fieldsOf(await service.getConfiguration(companyId, 'vendor'));

      expect(byKey.bankName).toMatchObject({
        visible: true,
        registrationVisible: false,
        registrationConfigurable: false,
      });
      expect(byKey.website).toMatchObject({ registrationConfigurable: true });

      await service.updateConfiguration(companyId, 'vendor', {
        fields: [{ fieldKey: 'bankName', isRegistrationVisible: false }],
      });
      expect(repository.upsertOverride).not.toHaveBeenCalled();
    });

    it('PUT with only isRegistrationVisible returns the GET shape and keeps Add Vendor visibility', async () => {
      const { service } = makeService({
        findOverrides: jest
          .fn()
          .mockResolvedValue([{ fieldKey: 'fax', isVisible: false, isRegistrationVisible: null }]),
      });
      const result = await service.updateConfiguration(companyId, 'vendor', {
        fields: [{ fieldKey: 'phone', isRegistrationVisible: false }],
      });

      expect(result).toHaveProperty('entityType', 'vendor');
      expect(result).toHaveProperty('sections');
      expect(fieldsOf(result).fax).toMatchObject({ visible: false });
    });

    it('turning registration back on removes the override row', async () => {
      const { service, repository } = makeService({
        findOverrides: jest
          .fn()
          .mockResolvedValue([{ fieldKey: 'bankName', isVisible: null, isRegistrationVisible: false }]),
      });
      await service.updateConfiguration(companyId, 'vendor', {
        fields: [{ fieldKey: 'bankName', isRegistrationVisible: true }],
      });
      expect(repository.clearVisibilityOverride).toHaveBeenCalledWith(companyId, 'vendor', 'bankName');
      expect(repository.upsertOverride).not.toHaveBeenCalled();
    });
  });

  it('reset removes all overrides', async () => {
    const { service, repository } = makeService();
    await service.resetConfiguration(companyId, 'vendor');
    expect(repository.deleteAllOverrides).toHaveBeenCalledWith(companyId, 'vendor');
  });

  it('returns Contact phone built-ins phone, mobile, and tel2', async () => {
    const { service } = makeService();
    const result = await service.getConfiguration(companyId, 'vendor');
    const contact = result.sections.find((s: { sectionKey: string }) => s.sectionKey === 'contact');
    const byKey = Object.fromEntries(
      (contact?.fields ?? []).map((f: { fieldKey: string; label: string }) => [f.fieldKey, f]),
    ) as Record<string, { fieldKey: string; label: string; sectionKey: string; source: string; configurable: boolean; fieldType: string }>;
    for (const fieldKey of ['phone', 'mobile', 'tel2']) {
      expect(byKey[fieldKey]).toMatchObject({
        fieldKey,
        sectionKey: 'contact',
        source: 'BUILT_IN',
        configurable: true,
      });
      expect(byKey[fieldKey].fieldType).toBe('text');
    }
    expect(byKey.phone.label).toBe('Tel 1');
    expect(byKey.mobile.label).toBe('Mobile phone');
    expect(byKey.tel2.label).toBe('Tel 2');
    const allKeys = result.sections.flatMap((s: { fields: { fieldKey: string }[] }) =>
      s.fields.map((f) => f.fieldKey),
    );
    expect(allKeys).not.toContain('countryCode');
    expect(allKeys).not.toContain('dialCode');
  });

  it('returns the full Vendor Form Config registry FE expects', async () => {
    const { service } = makeService();
    const result = await service.getConfiguration(companyId, 'vendor');
    const allKeys = result.sections.flatMap((s: { fields: { fieldKey: string }[] }) =>
      s.fields.map((f) => f.fieldKey),
    );
    const bySection = Object.fromEntries(
      result.sections.map((s: { sectionKey: string; fields: { fieldKey: string }[] }) => [
        s.sectionKey,
        s.fields.map((f) => f.fieldKey),
      ]),
    ) as Record<string, string[]>;

    expect(allKeys).toEqual(
      expect.arrayContaining([
        'vendorCategory',
        'supplierCode',
        'vendorName',
        'foreignName',
        'aliasName',
        'group',
        'currency',
        'bpType',
        'industry',
        'federalTaxId',
        'phone',
        'tel2',
        'mobile',
        'fax',
        'email',
        'website',
        'shippingType',
        'contactPerson',
        'address',
        'city',
        'country',
        'paymentTerms',
        'paymentMethod',
        'interestArrears',
        'priceList',
        'totalDiscount',
        'creditLimit',
        'commitmentLimit',
        'effectiveDiscount',
        'dunningTerm',
        'bankCountry',
        'bankName',
        'bankCode',
        'bankAccount',
        'bankBranch',
        'bankSwift',
        'bankIban',
        'houseBankCountry',
        'houseBank',
        'houseBankAccount',
        'houseBankBranch',
        'houseBankIban',
        'houseBankSwift',
        'referenceDetails',
        'paymentBlock',
        'singlePayment',
        'consolidatingBp',
        'planningGroup',
        'accountsPayable',
        'downPaymentClearing',
        'downPaymentInterim',
        'affiliate',
        'remarks',
      ]),
    );
    expect(allKeys).not.toContain('taxId');
    expect(allKeys).not.toContain('discountPercent');
    expect(allKeys).not.toContain('iban');
    expect(allKeys).not.toContain('swift');
    expect(allKeys).not.toContain('countryCode');
    expect(bySection.payment).toEqual(
      expect.arrayContaining([
        'paymentTerms',
        'interestArrears',
        'priceList',
        'totalDiscount',
        'creditLimit',
        'commitmentLimit',
        'effectiveDiscount',
        'dunningTerm',
      ]),
    );
    expect(bySection.bank).toEqual(
      expect.arrayContaining([
        'bankCountry',
        'bankName',
        'bankCode',
        'bankAccount',
        'bankBranch',
        'bankSwift',
        'bankIban',
      ]),
    );
    expect(bySection.paymentRun).toEqual(
      expect.arrayContaining([
        'houseBankCountry',
        'houseBank',
        'referenceDetails',
        'paymentBlock',
        'singlePayment',
      ]),
    );
    expect(bySection.accounting).toEqual(
      expect.arrayContaining([
        'consolidatingBp',
        'planningGroup',
        'accountsPayable',
        'downPaymentClearing',
        'downPaymentInterim',
        'affiliate',
      ]),
    );
  });

  it('accepts legacy taxId on PUT and stores federalTaxId', async () => {
    const { service, repository } = makeService();
    await service.updateConfiguration(companyId, 'vendor', {
      fields: [{ fieldKey: 'taxId', isVisible: false }],
    });
    expect(repository.upsertOverride).toHaveBeenCalledWith(companyId, 'vendor', 'federalTaxId', {
      isVisible: false,
      isRegistrationVisible: null,
    });
    expect(repository.deleteOverride).toHaveBeenCalledWith(companyId, 'vendor', 'taxId');
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
    expect(repository.upsertOverride).toHaveBeenCalledWith(companyId, 'item', 'purchase.weight', {
      isVisible: false,
      isRegistrationVisible: null,
    });
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

  describe('field display order', () => {
    const address = ['address', 'city', 'country'];
    const courier = {
      fieldId: 99n,
      fieldName: 'courier',
      displayName: 'Courier',
      fieldType: 'text',
      sectionKey: 'address',
      isHidden: false,
      isRegistrationVisible: true,
      isRequired: false,
      sortOrder: 0,
    };
    const orderOf = (result: { sections: { sectionKey: string; fields: { fieldKey: string }[] }[] }, key: string) =>
      result.sections.find((s) => s.sectionKey === key)?.fields.map((f) => f.fieldKey);
    const expectCode = async (promise: Promise<unknown>, code: string, field: string) => {
      await expect(promise).rejects.toBeInstanceOf(BusinessException);
      await promise.catch((err: BusinessException) => {
        expect(err.getResponse()).toMatchObject({ code, errors: [expect.objectContaining({ field })] });
      });
    };

    it('lists custom fields after built-ins by default with displayOrder 1..n', async () => {
      const { service } = makeService({}, [], [courier]);
      const result = await service.getConfiguration(companyId, 'vendor');
      const section = result.sections.find((s: { sectionKey: string }) => s.sectionKey === 'address')!;
      expect(section.fields.map((f: { fieldKey: string }) => f.fieldKey)).toEqual([...address, 'courier']);
      expect(section.fields.map((f: { displayOrder: number }) => f.displayOrder)).toEqual([1, 2, 3, 4]);
      expect(section.fields[3]).toMatchObject({ source: 'CUSTOM', fieldId: '99', configurable: false });
    });

    it('applies the saved order, including hidden fields and custom fields between built-ins', async () => {
      const { service } = makeService(
        {
          findOverrides: jest.fn().mockResolvedValue([
            { fieldKey: 'country', isVisible: false, isRegistrationVisible: null, displayOrder: 1 },
            { fieldKey: 'address', isVisible: null, isRegistrationVisible: null, displayOrder: 3 },
            { fieldKey: 'city', isVisible: null, isRegistrationVisible: null, displayOrder: 4 },
          ]),
        },
        [],
        [{ ...courier, sortOrder: 2 }],
      );
      const result = await service.getConfiguration(companyId, 'vendor');
      expect(orderOf(result, 'address')).toEqual(['country', 'courier', 'address', 'city']);
      expect(orderOf(result, 'contact')?.[0]).toBe('email');
    });

    it('saves a full section and writes built-in and custom positions', async () => {
      const { service, repository, auditService } = makeService({}, [], [courier]);
      await service.updateFieldOrder(
        companyId,
        'vendor',
        {
          sections: [
            {
              sectionKey: 'address',
              fields: [
                { fieldKey: 'courier', source: 'CUSTOM', displayOrder: 1 },
                { fieldKey: 'country', source: 'BUILT_IN', displayOrder: 2 },
                { fieldKey: 'address', source: 'BUILT_IN', displayOrder: 3 },
                { fieldKey: 'city', source: 'BUILT_IN', displayOrder: 4 },
              ],
            },
          ],
        },
        '7',
      );
      expect(repository.saveFieldOrder).toHaveBeenCalledWith(
        companyId,
        'vendor',
        [
          { fieldKey: 'country', displayOrder: 2 },
          { fieldKey: 'address', displayOrder: 3 },
          { fieldKey: 'city', displayOrder: 4 },
        ],
        [{ fieldId: 99n, sortOrder: 1 }],
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ companyId, performedBy: '7', entityName: 'FormFieldOrder' }),
      );
    });

    const orderDto = (fields: Array<{ fieldKey: string; source: 'BUILT_IN' | 'CUSTOM'; displayOrder: number }>, sectionKey = 'address') => ({
      sections: [{ sectionKey, fields }],
    });
    const builtIn = (fieldKey: string, displayOrder: number) => ({
      fieldKey,
      source: 'BUILT_IN' as const,
      displayOrder,
    });

    it('rejects a duplicate displayOrder', async () => {
      const { service, repository } = makeService();
      await expectCode(
        service.updateFieldOrder(
          companyId,
          'vendor',
          orderDto([builtIn('address', 1), builtIn('city', 1), builtIn('country', 2)]),
          '7',
        ),
        'FORM_CONFIG_DUPLICATE_ORDER',
        'sections[0].fields[1].displayOrder',
      );
      expect(repository.saveFieldOrder).not.toHaveBeenCalled();
    });

    it('rejects a section with a missing field', async () => {
      const { service } = makeService({}, [], [courier]);
      await expectCode(
        service.updateFieldOrder(
          companyId,
          'vendor',
          orderDto([builtIn('address', 1), builtIn('city', 2), builtIn('country', 3)]),
          '7',
        ),
        'FORM_CONFIG_INCOMPLETE_SECTION',
        'sections[0].fields',
      );
    });

    it('rejects a custom field that is not in this company or section', async () => {
      const { service } = makeService();
      await expectCode(
        service.updateFieldOrder(
          companyId,
          'vendor',
          orderDto([
            builtIn('address', 1),
            builtIn('city', 2),
            builtIn('country', 3),
            { fieldKey: 'courier', source: 'CUSTOM', displayOrder: 4 },
          ]),
          '7',
        ),
        'FORM_CONFIG_INVALID_FIELD',
        'sections[0].fields[3].fieldKey',
      );
    });

    it('rejects a built-in from another section and an unknown section', async () => {
      const { service } = makeService();
      await expectCode(
        service.updateFieldOrder(
          companyId,
          'vendor',
          orderDto([builtIn('address', 1), builtIn('email', 2)]),
          '7',
        ),
        'FORM_CONFIG_INVALID_FIELD',
        'sections[0].fields[1].fieldKey',
      );
      await expectCode(
        service.updateFieldOrder(companyId, 'vendor', orderDto([], 'nope'), '7'),
        'FORM_CONFIG_INVALID_SECTION',
        'sections[0].sectionKey',
      );
    });

    it('visibility PUT skips custom field keys', async () => {
      const { service, repository } = makeService({}, [], [courier]);
      await service.updateConfiguration(companyId, 'vendor', {
        fields: [{ fieldKey: 'courier', isVisible: false }],
      });
      expect(repository.upsertOverride).not.toHaveBeenCalled();
      expect(repository.clearVisibilityOverride).not.toHaveBeenCalled();
    });
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
