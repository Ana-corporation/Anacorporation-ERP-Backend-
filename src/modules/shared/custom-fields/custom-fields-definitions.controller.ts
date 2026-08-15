import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CustomFieldsDefinitionsService } from './custom-fields.service';
import {
  CreateCustomFieldDefinitionDto,
  CustomFieldDefinitionsQueryDto,
  UpdateCustomFieldDefinitionDto,
} from './dto/custom-field-definition.dto';

@ApiTags('Custom Fields')
@ApiBearerAuth()
@Controller('companies/:companyId/custom-fields')
export class CustomFieldsDefinitionsController {
  constructor(private readonly definitionsService: CustomFieldsDefinitionsService) {}

  @Get()
  @RequirePermissions('custom_fields:view')
  @ApiOperation({ summary: 'List custom field definitions for a company' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: CustomFieldDefinitionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.definitionsService.findAll(companyId, query);
  }

  @Get(':fieldId')
  @RequirePermissions('custom_fields:view')
  @ApiOperation({ summary: 'Get custom field definition by ID' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('fieldId') fieldId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.definitionsService.findOne(fieldId, companyId);
  }

  @Post()
  @RequirePermissions('custom_fields:create')
  @ApiOperation({
    summary: 'Create custom field definition (admin direct — no approval workflow)',
  })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateCustomFieldDefinitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.definitionsService.create(companyId, dto, user.sub);
  }

  @Patch(':fieldId')
  @RequirePermissions('custom_fields:edit')
  @ApiOperation({ summary: 'Update custom field definition' })
  update(
    @Param('companyId') companyId: string,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateCustomFieldDefinitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.definitionsService.update(fieldId, companyId, dto, user.sub);
  }

  @Delete(':fieldId')
  @RequirePermissions('custom_fields:delete')
  @ApiOperation({ summary: 'Deactivate custom field definition' })
  remove(
    @Param('companyId') companyId: string,
    @Param('fieldId') fieldId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.definitionsService.remove(fieldId, companyId, user.sub);
  }
}
