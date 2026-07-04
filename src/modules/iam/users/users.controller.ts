import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { AssignUserRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users:view')
  @ApiOperation({ summary: 'List users in current company' })
  findAll(@CompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.usersService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('users:view')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @RequirePermissions('users:create')
  @ApiOperation({ summary: 'Create user in current company' })
  create(
    @CompanyId() companyId: string,
    @Body() dto: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('users:edit')
  @ApiOperation({ summary: 'Update user' })
  update(
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('users:delete')
  @ApiOperation({ summary: 'Delete user' })
  remove(
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.remove(id, companyId, user.sub);
  }

  @Post(':id/roles')
  @RequirePermissions('roles:edit')
  @ApiOperation({ summary: 'Assign role to user' })
  assignRole(
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: AssignUserRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.assignRole(id, companyId, dto, user.sub);
  }
}
