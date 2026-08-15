import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  CreatePermissionSetDto,
  SetRolePermissionSetsDto,
  UpdatePermissionSetDto,
} from './dto/permission-set.dto';
import { PermissionSetsService } from './permission-sets.service';

@ApiTags('Permission Sets')
@ApiBearerAuth()
@Controller('companies/:companyId')
export class PermissionSetsController {
  constructor(private readonly permissionSetsService: PermissionSetsService) {}

  @Get('permission-sets')
  @RequirePermissions('permission_sets:view')
  @ApiOperation({ summary: 'List company permission sets' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.permissionSetsService.findAll(companyId, query);
  }

  @Post('permission-sets')
  @RequirePermissions('permission_sets:create')
  @ApiOperation({ summary: 'Create permission set' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreatePermissionSetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.permissionSetsService.create(companyId, dto, user.sub);
  }

  @Get('permission-sets/:id')
  @RequirePermissions('permission_sets:view')
  @ApiOperation({ summary: 'Get permission set' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.permissionSetsService.findOne(id, companyId);
  }

  @Patch('permission-sets/:id')
  @RequirePermissions('permission_sets:edit')
  @ApiOperation({ summary: 'Update permission set' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePermissionSetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.permissionSetsService.update(id, companyId, dto, user.sub);
  }

  @Delete('permission-sets/:id')
  @RequirePermissions('permission_sets:delete')
  @ApiOperation({ summary: 'Soft-delete permission set' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.permissionSetsService.remove(id, companyId, user.sub);
  }

  @Get('roles/:roleId/permission-sets')
  @RequirePermissions('roles:view')
  @ApiOperation({ summary: 'List permission sets linked to role' })
  getRolePermissionSets(
    @Param('companyId') companyId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.permissionSetsService.getRolePermissionSets(companyId, roleId);
  }

  @Put('roles/:roleId/permission-sets')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Replace permission sets linked to role' })
  setRolePermissionSets(
    @Param('companyId') companyId: string,
    @Param('roleId') roleId: string,
    @Body() dto: SetRolePermissionSetsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.permissionSetsService.setRolePermissionSets(companyId, roleId, dto, user.sub);
  }
}
