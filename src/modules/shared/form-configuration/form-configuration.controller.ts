import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { UpdateFormConfigurationDto } from './dto/form-configuration.dto';
import { FormConfigurationService } from './form-configuration.service';

@ApiTags('Form Configuration')
@ApiBearerAuth()
@Controller('companies/:companyId/form-configurations')
export class FormConfigurationController {
  constructor(private readonly formConfigurationService: FormConfigurationService) {}

  @Get(':entityType')
  @RequirePermissions('form_configurations:view')
  @ApiOperation({ summary: 'Get built-in field configuration for an entity (effective visibility)' })
  getConfiguration(
    @Param('companyId') companyId: string,
    @Param('entityType') entityType: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.formConfigurationService.getConfiguration(companyId, entityType);
  }

  @Put(':entityType')
  @RequirePermissions('form_configurations:edit')
  @ApiOperation({ summary: 'Update company built-in field visibility overrides' })
  updateConfiguration(
    @Param('companyId') companyId: string,
    @Param('entityType') entityType: string,
    @Body() dto: UpdateFormConfigurationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.formConfigurationService.updateConfiguration(companyId, entityType, dto);
  }

  @Delete(':entityType')
  @RequirePermissions('form_configurations:edit')
  @ApiOperation({ summary: 'Reset entity form configuration to ERP defaults' })
  resetConfiguration(
    @Param('companyId') companyId: string,
    @Param('entityType') entityType: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.formConfigurationService.resetConfiguration(companyId, entityType);
  }
}
