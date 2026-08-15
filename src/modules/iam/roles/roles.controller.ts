import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
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
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('roles:view')
  @ApiOperation({ summary: 'Get role by ID' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('roles:create')
  @ApiOperation({ summary: 'Create custom role (no auto permissions)' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.create(companyId, dto, user.sub);
  }

  @Post(':id/clone')
  @RequirePermissions('roles:create')
  @ApiOperation({ summary: 'Clone role (copies permissions, isSystem=false)' })
  clone(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: CloneRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.clone(id, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Update role (system roles cannot be renamed)' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('roles:delete')
  @ApiOperation({ summary: 'Delete custom role (system roles blocked)' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.remove(id, companyId, user.sub);
  }

  @Put(':id/permissions')
  @RequirePermissions('roles:edit')
  @ApiOperation({
    summary: 'Replace role permissions by permissionCodes (system + custom)',
  })
  setPermissions(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.setPermissions(id, companyId, dto, user.sub);
  }
}
