import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  CloneRoleDto,
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('companies/:companyId/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('roles:view')
  @ApiOperation({ summary: 'List roles for company' })
  findAll(@Param('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.rolesService.findAll(companyId, query);
  }

  @Get(':id/permissions')
  @RequirePermissions('roles:view')
  @ApiOperation({ summary: 'Get role permissions matrix' })
  getPermissions(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.rolesService.getPermissions(id, companyId);
  }

  @Get(':id')
  @RequirePermissions('roles:view')
  @ApiOperation({ summary: 'Get role by ID' })
  findOne(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.rolesService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('roles:create')
  @ApiOperation({ summary: 'Create role' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.create(companyId, dto, user.sub);
  }

  @Post(':id/clone')
  @RequirePermissions('roles:create')
  @ApiOperation({ summary: 'Clone role with permissions' })
  clone(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: CloneRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.clone(id, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Update role' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('roles:delete')
  @ApiOperation({ summary: 'Delete role' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.remove(id, companyId, user.sub);
  }

  @Put(':id/permissions')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Replace role permissions (ids, codes, or module+action)' })
  setPermissions(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.setPermissions(id, companyId, dto, user.sub);
  }
}
