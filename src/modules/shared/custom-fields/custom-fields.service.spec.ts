import { UpdateCustomFieldDefinitionSchema } from './dto/custom-field-definition.dto';
import { CustomFieldsDefinitionsService } from './custom-fields.service';
import { CustomFieldsValidationService } from './custom-fields-validation.service';
import { CustomFieldsRepository } from './custom-fields.repository';

describe('CustomFieldsDefinitionsService — registration switch', () => {
  const existing = {
    fieldId: 71n,
    companyId: 28n,
    entityType: 'vendor',
    fieldName: 'msmeType',
    displayName: 'MSME type',
    fieldType: 'dropdown',
    sectionKey: 'general',
    isRequired: true,
    defaultValue: null,
    validation: null,
    options: [{ value: 'MICRO', label: 'Micro' }],
    placeholder: null,
    helpText: null,
    description: null,
    sortOrder: 3,
    isActive: true,
    isReadOnly: false,
    isHidden: false,
    isRegistrationVisible: true,
    isSearchable: false,
    isFilterable: false,
    isSortable: false,
    isExportable: true,
    isPrintable: true,
    createdBy: null,
    createdAt: new Date(),
    updatedBy: null,
    updatedAt: null,
    deletedAt: null,
  };

  it('accepts a PATCH body with only isRegistrationVisible and writes only that key', async () => {
    const dto = UpdateCustomFieldDefinitionSchema.parse({ isRegistrationVisible: false });
    expect(dto).toEqual({ isRegistrationVisible: false });

    const repository = {
      findDefinitionById: jest.fn().mockResolvedValue(existing),
      updateDefinition: jest.fn().mockResolvedValue({ ...existing, isRegistrationVisible: false }),
    };
    const service = new CustomFieldsDefinitionsService(
      repository as unknown as CustomFieldsRepository,
      new CustomFieldsValidationService(),
    );

    const result = (await service.update('71', '28', dto, '7')) as Record<string, unknown>;

    expect(repository.updateDefinition).toHaveBeenCalledWith('71', { isRegistrationVisible: false }, '7', undefined);
    expect(result).toMatchObject({
      isRegistrationVisible: false,
      registrationVisible: false,
      isRequired: true,
      isHidden: false,
      displayName: 'MSME type',
    });
  });
});
