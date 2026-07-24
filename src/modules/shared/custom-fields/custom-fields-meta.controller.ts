import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CustomFieldsDefinitionsService } from './custom-fields.service';

@ApiTags('Custom Fields Meta')
@ApiBearerAuth()
@Controller('custom-fields/meta')
export class CustomFieldsMetaController {
  constructor(private readonly definitionsService: CustomFieldsDefinitionsService) {}

  @Get('modules')
  @RequirePermissions('custom_fields:view')
  @ApiOperation({ summary: 'List modules that support custom fields' })
  listModules() {
    return this.definitionsService.listModules();
  }

  @Get('modules/:entityType/sections')
  @RequirePermissions('custom_fields:view')
  @ApiOperation({ summary: 'List sections (+ reserved field names) for a module' })
  listSections(@Param('entityType') entityType: string) {
    return this.definitionsService.listSections(entityType);
  }
}
