import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { ForbiddenException } from '@/common/exceptions/business.exception';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { AssignUserRoleDto, InviteUserDto, UpdateUserDto } from './dto/user.dto';
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

  private assertCompanyAccess(pathCompanyId: string, user: AuthenticatedUser) {
    if (user.companyId && pathCompanyId !== user.companyId) {
      throw new ForbiddenException('Company context mismatch');
    }
  }

  @Get()
  @RequirePermissions('users:view')
  @ApiOperation({ summary: 'List users in company' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertCompanyAccess(companyId, user);
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
    this.assertCompanyAccess(companyId, user);
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
    this.assertCompanyAccess(companyId, user);
    return this.usersService.findOne(userId);
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
    this.assertCompanyAccess(companyId, user);
    return this.usersService.update(userId, companyId, dto, user.sub);
  }

  @Put(':userId/role')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Assign / replace primary role for user in company' })
  assignRole(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: AssignUserRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertCompanyAccess(companyId, user);
    return this.usersService.assignRole(userId, companyId, dto, user.sub);
  }

  @Delete(':userId')
  @RequirePermissions('users:delete')
  @ApiOperation({ summary: 'Soft-delete user' })
  remove(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertCompanyAccess(companyId, user);
    return this.usersService.remove(userId, companyId, user.sub);
  }
}
