import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserLoginHistoryDto } from './dto/user-login-history.dto';
import { UserLoginHistoryService } from './user-login-history.service';

@ApiTags('User Login History')
@ApiBearerAuth()
@Controller('users/:userId/login-history')
export class UserLoginHistoryController {
  constructor(private readonly userLoginHistoryService: UserLoginHistoryService) {}

  @Get()
  @RequirePermissions('user_login_history:view')
  @ApiOperation({ summary: 'List login history for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userLoginHistoryService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_login_history:view')
  @ApiOperation({ summary: 'Get login history entry by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userLoginHistoryService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_login_history:create')
  @ApiOperation({ summary: 'Record a login history entry' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserLoginHistoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userLoginHistoryService.create(userId, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_login_history:delete')
  @ApiOperation({ summary: 'Delete login history entry' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userLoginHistoryService.remove(userId, companyId, id, user.sub);
  }
}
