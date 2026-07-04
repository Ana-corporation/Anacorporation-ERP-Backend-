import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserSessionDto, UpdateUserSessionDto } from './dto/user-session.dto';
import { UserSessionsService } from './user-sessions.service';

@ApiTags('User Sessions')
@ApiBearerAuth()
@Controller('users/:userId/sessions')
export class UserSessionsController {
  constructor(private readonly userSessionsService: UserSessionsService) {}

  @Get()
  @RequirePermissions('user_sessions:view')
  @ApiOperation({ summary: 'List sessions for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userSessionsService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_sessions:view')
  @ApiOperation({ summary: 'Get user session by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userSessionsService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_sessions:create')
  @ApiOperation({ summary: 'Create a user session record' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userSessionsService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_sessions:edit')
  @ApiOperation({ summary: 'Update session metadata or status' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userSessionsService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_sessions:delete')
  @ApiOperation({ summary: 'Delete user session record' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userSessionsService.remove(userId, companyId, id, user.sub);
  }
}
