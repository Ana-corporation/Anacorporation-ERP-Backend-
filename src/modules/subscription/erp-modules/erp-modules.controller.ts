import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateErpModuleDto, UpdateErpModuleDto } from './dto/erp-module.dto';
import { ErpModulesService } from './erp-modules.service';

@ApiTags('ERP Modules')
@ApiBearerAuth()
@Controller('subscription/modules')
export class ErpModulesController {
  constructor(private readonly erpModulesService: ErpModulesService) {}

  @Get()
  @RequirePermissions('subscription_modules:view')
  @ApiOperation({ summary: 'List ERP modules catalogue' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.erpModulesService.findAll(query);
  }

  @Get('grantable')
  @RequirePermissions('subscription_modules:view')
  @ApiOperation({
    summary: 'List AVAILABLE product modules (for company entitlement grant UI)',
  })
  findGrantable() {
    return this.erpModulesService.findGrantable();
  }

  @Get(':id')
  @RequirePermissions('subscription_modules:view')
  @ApiOperation({ summary: 'Get ERP module by ID' })
  findOne(@Param('id') id: string) {
    return this.erpModulesService.findOne(id);
  }

  @Post()
  @RequirePermissions('subscription_modules:create')
  @ApiOperation({ summary: 'Create ERP module' })
  create(@Body() dto: CreateErpModuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.erpModulesService.create(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('subscription_modules:edit')
  @ApiOperation({ summary: 'Update ERP module' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateErpModuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.erpModulesService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('subscription_modules:delete')
  @ApiOperation({ summary: 'Delete ERP module' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.erpModulesService.remove(id, user.sub);
  }
}
