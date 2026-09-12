import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, TenantOptional } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateErpModuleDto, UpdateErpModuleDto } from './dto/erp-module.dto';
import { ErpModulesService } from './erp-modules.service';

/** FE-facing alias of /subscription/modules */
@ApiTags('Modules')
@ApiBearerAuth()
@Controller('modules')
export class ModulesAliasController {
  constructor(private readonly erpModulesService: ErpModulesService) {}

  @Get()
  @TenantOptional()
  @RequirePermissions('modules:view')
  @ApiOperation({ summary: 'List ERP modules catalogue (FE alias)' })
  findAll(@Query() query: PaginationQueryDto & { moduleType?: string }) {
    return this.erpModulesService.findAll(query);
  }

  @Get(':id')
  @TenantOptional()
  @RequirePermissions('modules:view')
  @ApiOperation({ summary: 'Get module by ID (FE alias)' })
  findOne(@Param('id') id: string) {
    return this.erpModulesService.findOne(id);
  }

  @Post()
  @TenantOptional()
  @RequirePermissions('modules:create')
  @ApiOperation({ summary: 'Create module (FE alias)' })
  create(@Body() dto: CreateErpModuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.erpModulesService.create(dto, user.sub);
  }

  @Patch(':id')
  @TenantOptional()
  @RequirePermissions('modules:edit')
  @ApiOperation({ summary: 'Update module (FE alias)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateErpModuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.erpModulesService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @TenantOptional()
  @RequirePermissions('modules:delete')
  @ApiOperation({ summary: 'Delete/deactivate module (FE alias)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.erpModulesService.remove(id, user.sub);
  }
}
