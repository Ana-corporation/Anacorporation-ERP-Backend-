import { Module } from '@nestjs/common';
import { UserNotificationsController } from './user-notifications.controller';
import { UserNotificationsRepository } from './user-notifications.repository';
import { UserNotificationsService } from './user-notifications.service';

@Module({
  controllers: [UserNotificationsController],
  providers: [UserNotificationsRepository, UserNotificationsService],
  exports: [UserNotificationsService, UserNotificationsRepository],
})
export class UserNotificationsModule {}
