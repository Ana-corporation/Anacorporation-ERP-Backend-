import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserPreferenceDto, UpdateUserPreferenceDto } from './dto/user-preference.dto';
import { UserPreferencesService } from './user-preferences.service';

@ApiTags('User Preferences')
@ApiBearerAuth()
@Controller('users/:userId/preferences')
export class UserPreferencesController {
  constructor(private readonly userPreferencesService: UserPreferencesService) {}

  @Get()
  @RequirePermissions('user_preferences:view')
  @ApiOperation({ summary: 'List preferences for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userPreferencesService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_preferences:view')
  @ApiOperation({ summary: 'Get user preference by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userPreferencesService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_preferences:create')
  @ApiOperation({ summary: 'Create user preferences' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserPreferenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userPreferencesService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_preferences:edit')
  @ApiOperation({ summary: 'Update user preferences' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserPreferenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userPreferencesService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_preferences:delete')
  @ApiOperation({ summary: 'Delete user preferences' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userPreferencesService.remove(userId, companyId, id, user.sub);
  }
}
