import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserDelegationDto, UpdateUserDelegationDto } from './dto/user-delegation.dto';
import { UserDelegationsService } from './user-delegations.service';

@ApiTags('User Delegations')
@ApiBearerAuth()
@Controller('users/:userId/delegations')
export class UserDelegationsController {
  constructor(private readonly userDelegationsService: UserDelegationsService) {}

  @Get()
  @RequirePermissions('user_delegations:view')
  @ApiOperation({ summary: 'List delegations for a user (as delegator)' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userDelegationsService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_delegations:view')
  @ApiOperation({ summary: 'Get user delegation by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userDelegationsService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_delegations:create')
  @ApiOperation({ summary: 'Create a delegation from user to delegate' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserDelegationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDelegationsService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_delegations:edit')
  @ApiOperation({ summary: 'Update delegation dates, reason, or status' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserDelegationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDelegationsService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_delegations:delete')
  @ApiOperation({ summary: 'Delete user delegation' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDelegationsService.remove(userId, companyId, id, user.sub);
  }
}
