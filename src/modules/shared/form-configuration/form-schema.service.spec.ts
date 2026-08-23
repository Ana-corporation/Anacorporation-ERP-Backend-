import { FormSchemaService } from './form-schema.service';
import { FormConfigurationService } from './form-configuration.service';
import { FormConfigurationRepository } from './form-configuration.repository';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
import { CustomFieldsValidationService } from '../custom-fields/custom-fields-validation.service';

describe('FormSchemaService', () => {
  const companyId = '15';

  function makeService(overrideRows: Array<{ fieldKey: string; isVisible: boolean }> = []) {
    const formConfigurationRepository = {
      findOverrides: jest.fn().mockResolvedValue(overrideRows),
    } as unknown as FormConfigurationRepository;

    const formConfigurationService = new FormConfigurationService(formConfigurationRepository);

    const customFieldsRepository = {
      findDefinitionsByCompany: jest.fn().mockResolvedValue([
        {
          fieldId: 99n,
          fieldName: 'preferred_courier',
          displayName: 'Preferred Courier',
          fieldType: 'text',
          sectionKey: 'custom',
          isHidden: false,
          isRequired: false,
          isFilterable: false,
          isReadOnly: false,
          defaultValue: null,
          validation: null,
          options: null,
          placeholder: null,
          helpText: null,
          sortOrder: 1,
        },
      ]),
    } as unknown as CustomFieldsRepository;

    return new FormSchemaService(
      formConfigurationService,
      customFieldsRepository,
      new CustomFieldsValidationService(),
    );
  }

  it('hides website in resolvedSections when company override is false', async () => {
    const service = makeService([{ fieldKey: 'website', isVisible: false }]);
    const schema = (await service.resolveFormSchema(companyId, 'vendor')) as {
      resolvedSections: Array<{ fields: Array<{ key: string }> }>;
    };

    const allKeys = schema.resolvedSections.flatMap((s) => s.fields.map((f) => f.key));
    expect(allKeys).not.toContain('website');
    expect(allKeys).toContain('email');
  });

  it('includes custom fields in resolvedSections alongside built-in', async () => {
    const service = makeService();
    const schema = (await service.resolveFormSchema(companyId, 'vendor')) as {
      resolvedSections: Array<{ fields: Array<{ key: string }> }>;
    };
    const allKeys = schema.resolvedSections.flatMap((s) => s.fields.map((f) => f.key));
    expect(allKeys).toContain('preferred_courier');
  });

  it('returns legacy fields[] as custom-only', async () => {
    const service = makeService();
    const schema = (await service.resolveFormSchema(companyId, 'vendor')) as {
      fields: Array<{ fieldName?: string }>;
      builtInFields: unknown[];
    };
    expect(schema.fields.every((f) => f.fieldName === 'preferred_courier')).toBe(true);
    expect(schema.builtInFields.length).toBeGreaterThan(40);
  });

  it('exposes apiKey on builtInFields', async () => {
    const service = makeService();
    const schema = (await service.resolveFormSchema(companyId, 'vendor')) as {
      builtInFields: Array<{ key: string; apiKey?: string }>;
    };
    const vendorName = schema.builtInFields.find((f) => f.key === 'vendorName');
    expect(vendorName?.apiKey).toBe('name');
    const website = schema.builtInFields.find((f) => f.key === 'website');
    expect(website?.apiKey).toBe('metadata.website');
  });

  it('resolves item form-schema with bag apiKeys and hides overridden fields', async () => {
    const service = makeService([
      { fieldKey: 'barcode', isVisible: false },
      { fieldKey: 'purchase.weight', isVisible: false },
    ]);
    const schema = (await service.resolveFormSchema(companyId, 'item')) as {
      entityType: string;
      builtInFields: Array<{ key: string; apiKey?: string; visible: boolean }>;
      resolvedSections: Array<{ sectionKey: string; fields: Array<{ key: string }> }>;
    };

    expect(schema.entityType).toBe('item');
    expect(schema.builtInFields.find((f) => f.key === 'barcode')?.visible).toBe(false);
    expect(schema.builtInFields.find((f) => f.key === 'purchase.weight')?.apiKey).toBe(
      'purchase.weight',
    );

    const allKeys = schema.resolvedSections.flatMap((s) => s.fields.map((f) => f.key));
    expect(allKeys).not.toContain('barcode');
    expect(allKeys).not.toContain('purchase.weight');
    expect(allKeys).toContain('itemCode');
    expect(allKeys).toContain('sales.weight');
    expect(schema.resolvedSections.some((s) => s.sectionKey === 'purchasing')).toBe(true);
  });
});
