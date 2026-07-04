import { Module } from '@nestjs/common';
import { UserLoginHistoryController } from './user-login-history.controller';
import { UserLoginHistoryRepository } from './user-login-history.repository';
import { UserLoginHistoryService } from './user-login-history.service';

@Module({
  controllers: [UserLoginHistoryController],
  providers: [UserLoginHistoryRepository, UserLoginHistoryService],
  exports: [UserLoginHistoryService, UserLoginHistoryRepository],
})
export class UserLoginHistoryModule {}
