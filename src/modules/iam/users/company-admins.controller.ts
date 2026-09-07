import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { SetPrimaryAdminDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Company Admins')
@ApiBearerAuth()
@Controller('companies/:companyId/admins')
export class CompanyAdminsController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users:view')
  @ApiOperation({ summary: 'List Company Admins (roleCode ADMIN)' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.findAdmins(companyId, query);
  }

  @Patch('primary')
  @RequirePermissions('users:edit')
  @ApiOperation({ summary: 'Set the primary Company Admin' })
  setPrimary(
    @Param('companyId') companyId: string,
    @Body() dto: SetPrimaryAdminDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.usersService.setPrimaryAdmin(companyId, dto.userId, user.sub);
  }
}
