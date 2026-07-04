import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserNotificationDto, UpdateUserNotificationDto } from './dto/user-notification.dto';
import { UserNotificationsService } from './user-notifications.service';

@ApiTags('User Notifications')
@ApiBearerAuth()
@Controller('users/:userId/notifications')
export class UserNotificationsController {
  constructor(private readonly userNotificationsService: UserNotificationsService) {}

  @Get()
  @RequirePermissions('user_notifications:view')
  @ApiOperation({ summary: 'Get notification settings for a user' })
  findSettings(@Param('userId') userId: string, @CompanyId() companyId: string) {
    return this.userNotificationsService.findSettings(userId, companyId);
  }

  @Post()
  @RequirePermissions('user_notifications:create')
  @ApiOperation({ summary: 'Create notification settings for a user' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserNotificationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userNotificationsService.create(userId, companyId, dto, user.sub);
  }

  @Patch()
  @RequirePermissions('user_notifications:edit')
  @ApiOperation({ summary: 'Update notification settings for a user' })
  update(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserNotificationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userNotificationsService.update(userId, companyId, dto, user.sub);
  }

  @Delete()
  @RequirePermissions('user_notifications:delete')
  @ApiOperation({ summary: 'Delete notification settings for a user' })
  remove(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userNotificationsService.remove(userId, companyId, user.sub);
  }
}
