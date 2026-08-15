import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  AssignUserRoleDto,
  InviteUserDto,
  ReplaceModuleAccessDto,
  UpdateMembershipDto,
  UpdateMembershipStatusDto,
  UpdateUserDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

/**
 * Company-scoped users API (matches FE: /companies/:companyId/users/...).
 * Keeps legacy /users controller for backward compatibility.
 */
@ApiTags('Company Users')
@ApiBearerAuth()
@Controller('companies/:companyId/users')
export class CompanyUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users:view')
  @ApiOperation({ summary: 'List users in company' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.findAll(companyId, query);
  }

  @Post('invite')
  @RequirePermissions('users:create')
  @ApiOperation({ summary: 'Invite user to company (BE generates credentials)' })
  invite(
    @Param('companyId') companyId: string,
    @Body() dto: InviteUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.invite(companyId, dto, user.sub);
  }

  @Get(':userId')
  @RequirePermissions('users:view')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.findOne(userId, companyId);
  }

  @Patch(':userId')
  @RequirePermissions('users:edit')
  @ApiOperation({ summary: 'Update user profile' })
  update(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.update(userId, companyId, dto, user.sub);
  }

  @Put(':userId/role')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Replace primary role for user in company (roleId null clears)' })
  assignRole(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: AssignUserRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.assignRole(userId, companyId, dto, user.sub);
  }

  @Patch(':userId/membership')
  @RequirePermissions('users:edit')
  @ApiOperation({ summary: 'Update company membership (employeeId, dept, branch, warehouse)' })
  updateMembership(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMembershipDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.updateMembership(userId, companyId, dto, user.sub);
  }

  @Patch(':userId/status')
  @RequirePermissions('users:edit')
  @ApiOperation({ summary: 'Update membership status (active | suspended)' })
  updateMembershipStatus(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMembershipStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.updateMembershipStatus(userId, companyId, dto, user.sub);
  }

  @Put(':userId/module-access')
  @RequirePermissions('user_module_access:edit')
  @ApiOperation({ summary: 'Replace user module-access overrides (omit = inherit role)' })
  replaceModuleAccess(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: ReplaceModuleAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.replaceModuleAccess(userId, companyId, dto, user.sub);
  }

  @Delete(':userId')
  @RequirePermissions('users:delete')
  @ApiOperation({ summary: 'Soft-delete user' })
  remove(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.remove(userId, companyId, user.sub);
  }
}
