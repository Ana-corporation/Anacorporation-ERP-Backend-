import { FormSchemaService } from './form-schema.service';
import { FormConfigurationService } from './form-configuration.service';
import { FormConfigurationRepository } from './form-configuration.repository';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
import { CustomFieldsValidationService } from '../custom-fields/custom-fields-validation.service';
import { TabAccessService } from '../tab-access/tab-access.service';

describe('FormSchemaService', () => {
  const companyId = '15';

  function makeService(
    overrideRows: Array<{ fieldKey: string; isVisible: boolean }> = [],
    visibleTabKeys?: Set<string>,
  ) {
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

    const tabAccessService = {
      getVisibleTabKeysForUser: jest.fn().mockResolvedValue(
        visibleTabKeys ??
          new Set([
            'general',
            'payment',
            'bank',
            'paymentRun',
            'accounting',
            'remarks',
            'attachments',
            'custom',
            'header',
            'classification',
            'purchasing',
            'sales',
            'inventory',
            'planning',
            'production',
            'properties',
          ]),
      ),
    } as unknown as TabAccessService;

    return new FormSchemaService(
      formConfigurationService,
      customFieldsRepository,
      new CustomFieldsValidationService(),
      tabAccessService,
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

  it('omits general/contact/address from form-schema when general tab hidden for user', async () => {
    const service = makeService(
      [],
      new Set(['payment', 'paymentRun', 'accounting', 'remarks', 'attachments', 'custom', 'bank']),
    );

    const user = {
      sub: '1',
      email: 'a@b.com',
      sessionId: 's',
      permissions: [],
      modules: [],
      subscriptionStatus: 'active',
      firstName: 'A',
      lastName: 'B',
    };

    const schema = (await service.resolveFormSchema(companyId, 'vendor', user as never)) as {
      resolvedSections: Array<{ sectionKey: string }>;
      sections: Array<{ key: string }>;
    };

    const sectionKeys = schema.resolvedSections.map((s) => s.sectionKey);
    expect(sectionKeys).not.toContain('general');
    expect(sectionKeys).not.toContain('contact');
    expect(sectionKeys).not.toContain('address');
    expect(sectionKeys).toContain('payment');
    expect(schema.sections.some((s) => s.key === 'general')).toBe(false);
  });
});
