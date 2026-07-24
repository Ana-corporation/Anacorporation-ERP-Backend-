import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireModulePermission } from '@/common/decorators/auth.decorators';
import { BusinessException } from '@/common/exceptions/business.exception';
import { CUSTOM_FIELD_ENTITY_TYPES, CustomFieldEntityType } from './custom-fields.constants';
import { CustomFieldsDefinitionsService } from './custom-fields.service';

@ApiTags('Form Schema')
@ApiBearerAuth()
@Controller('companies/:companyId/entities')
export class FormSchemaController {
  constructor(private readonly definitionsService: CustomFieldsDefinitionsService) {}

  @Get(':entityType/form-schema')
  @RequireModulePermission('supply-chain', 'view')
  @ApiOperation({ summary: 'Get dynamic form schema (custom fields) for an entity' })
  getFormSchema(
    @Param('companyId') companyId: string,
    @Param('entityType') entityType: string,
  ) {
    if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entityType as CustomFieldEntityType)) {
      throw new BusinessException(`Unsupported entity type: ${entityType}`);
    }

    return this.definitionsService.getFormSchema(
      companyId,
      entityType as CustomFieldEntityType,
    );
  }
}
