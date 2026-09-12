import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  AssignRolePersonDto,
  CloneRoleDto,
  CreateRoleDto,
  DeactivateRoleDto,
  ReassignRolePersonDto,
  SetRolePermissionsDto,
  UnassignRolePersonDto,
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
  @ApiOperation({
    summary: 'List roles (default status=ACTIVE). Use status=ALL|INACTIVE; includeAssigneeSummary=true',
  })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.findAll(companyId, query);
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

  @Get(':id/permissions')
  @RequirePermissions('roles:view')
  @ApiOperation({ summary: 'Get role permissions matrix' })
  getPermissions(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.getPermissions(id, companyId);
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

  @Post(':id/assign')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Assign a company member to this ACTIVE role' })
  assign(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: AssignRolePersonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.assignPerson(id, companyId, dto, user.sub);
  }

  @Post(':id/reassign')
  @RequirePermissions('roles:edit')
  @ApiOperation({
    summary: 'End one holder on this role and assign another (history preserved)',
  })
  reassign(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: ReassignRolePersonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.reassignPerson(id, companyId, dto, user.sub);
  }

  @Post(':id/unassign')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'End ACTIVE assignment; role stays ACTIVE (vacant for that user)' })
  unassign(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UnassignRolePersonDto | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.unassignPerson(id, companyId, dto ?? {}, user.sub);
  }

  @Post(':id/deactivate')
  @RequirePermissions('roles:edit')
  @ApiOperation({
    summary:
      'Retire role (INACTIVE) for SYSTEM or CUSTOM. Requires zero ACTIVE assignees. System roles allowed.',
  })
  deactivate(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: DeactivateRoleDto | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.deactivate(id, companyId, user.sub, dto ?? {});
  }

  @Post(':id/reactivate')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Reactivate retired role (does not auto-assign anyone)' })
  reactivate(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.reactivate(id, companyId, user.sub);
  }

  @Get(':id/assignments')
  @RequirePermissions('roles:view')
  @ApiOperation({ summary: 'List ACTIVE assignments; history=true includes ENDED periods' })
  listAssignments(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('history') history: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    const includeHistory = history === 'true' || history === '1';
    return this.rolesService.listAssignments(id, companyId, includeHistory);
  }

  @Put(':id/permissions')
  @RequirePermissions('roles:edit')
  @ApiOperation({
    summary:
      'Replace role permissions by permissionCodes (CUSTOM only). SYSTEM roles are locked — clone first.',
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
  @ApiOperation({
    summary:
      'Soft-delete custom role. Active assignees require ?reassignToRoleId=. History rows OK.',
  })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Query('reassignToRoleId') reassignToRoleId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.rolesService.remove(id, companyId, user.sub, {
      reassignToRoleId,
    });
  }
}
