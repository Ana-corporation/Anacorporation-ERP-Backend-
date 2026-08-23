import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireModulePermission } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { BusinessException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { FormSchemaService } from '../form-configuration/form-schema.service';
import { CUSTOM_FIELD_ENTITY_TYPES, CustomFieldEntityType } from './custom-fields.constants';

@ApiTags('Form Schema')
@ApiBearerAuth()
@Controller('companies/:companyId/entities')
export class FormSchemaController {
  constructor(private readonly formSchemaService: FormSchemaService) {}

  @Get(':entityType/form-schema')
  @RequireModulePermission('supply-chain', 'view')
  @ApiOperation({
    summary:
      'Get resolved form schema (built-in fields + company config + custom fields) for an entity',
  })
  getFormSchema(
    @Param('companyId') companyId: string,
    @Param('entityType') entityType: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entityType as CustomFieldEntityType)) {
      throw new BusinessException(`Unsupported entity type: ${entityType}`);
    }

    return this.formSchemaService.resolveFormSchema(
      companyId,
      entityType as CustomFieldEntityType,
    );
  }
}
