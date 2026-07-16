import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  InviteCompanyUserDto,
  SetCompanyUserModuleAccessDto,
  SetCompanyUserRoleDto,
  SetCompanyUserStatusDto,
  UpdateCompanyUserMembershipDto,
  UpdateCompanyUserProfileDto,
} from './dto/company-user.dto';
import { CompanyUsersService } from './company-users.service';

@ApiTags('Company Users')
@ApiBearerAuth()
@Controller('companies/:companyId/users')
export class CompanyUsersController {
  constructor(private readonly companyUsersService: CompanyUsersService) {}

  @Get()
  @RequirePermissions('users:view')
  @ApiOperation({ summary: 'List users in company with membership + role' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto & { status?: string; roleId?: string },
  ) {
    return this.companyUsersService.findAll(companyId, query);
  }

  @Post('invite')
  @RequirePermissions('users:create')
  @ApiOperation({ summary: 'Invite or create user in company' })
  invite(
    @Param('companyId') companyId: string,
    @Body() dto: InviteCompanyUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companyUsersService.invite(companyId, dto, user.sub);
  }

  @Patch(':userId')
  @RequirePermissions('users:edit')
  @ApiOperation({ summary: 'Update user profile in company' })
  updateProfile(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateCompanyUserProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companyUsersService.updateProfile(companyId, userId, dto, user.sub);
  }

  @Put(':userId/role')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Set primary role for user in company' })
  setRole(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: SetCompanyUserRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companyUsersService.setRole(companyId, userId, dto, user.sub);
  }

  @Patch(':userId/membership')
  @RequirePermissions('users:edit')
  @ApiOperation({ summary: 'Update employment / membership fields' })
  updateMembership(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateCompanyUserMembershipDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companyUsersService.updateMembership(companyId, userId, dto, user.sub);
  }

  @Patch(':userId/status')
  @RequirePermissions('users:edit')
  @ApiOperation({ summary: 'Suspend or activate company membership' })
  setStatus(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: SetCompanyUserStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companyUsersService.setStatus(companyId, userId, dto, user.sub);
  }

  @Put(':userId/module-access')
  @RequirePermissions('user_module_access:edit')
  @ApiOperation({ summary: 'Replace user module access overrides' })
  setModuleAccess(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() dto: SetCompanyUserModuleAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companyUsersService.setModuleAccess(companyId, userId, dto, user.sub);
  }

  @Delete(':userId')
  @RequirePermissions('users:delete')
  @ApiOperation({ summary: 'Remove user membership from company' })
  remove(
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companyUsersService.remove(companyId, userId, user.sub);
  }
}
