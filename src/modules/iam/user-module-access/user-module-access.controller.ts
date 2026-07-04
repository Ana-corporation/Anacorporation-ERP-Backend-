import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserModuleAccessDto, UpdateUserModuleAccessDto } from './dto/user-module-access.dto';
import { UserModuleAccessService } from './user-module-access.service';

@ApiTags('User Module Access')
@ApiBearerAuth()
@Controller('users/:userId/module-access')
export class UserModuleAccessController {
  constructor(private readonly userModuleAccessService: UserModuleAccessService) {}

  @Get()
  @RequirePermissions('user_module_access:view')
  @ApiOperation({ summary: 'List module access entries for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userModuleAccessService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_module_access:view')
  @ApiOperation({ summary: 'Get user module access by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userModuleAccessService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_module_access:create')
  @ApiOperation({ summary: 'Grant or deny module access for a user' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserModuleAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userModuleAccessService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_module_access:edit')
  @ApiOperation({ summary: 'Update module access entry' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserModuleAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userModuleAccessService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_module_access:delete')
  @ApiOperation({ summary: 'Delete user module access entry' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userModuleAccessService.remove(userId, companyId, id, user.sub);
  }
}
