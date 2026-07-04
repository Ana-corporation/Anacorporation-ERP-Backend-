import { Module } from '@nestjs/common';
import { UserSessionsController } from './user-sessions.controller';
import { UserSessionsRepository } from './user-sessions.repository';
import { UserSessionsService } from './user-sessions.service';

@Module({
  controllers: [UserSessionsController],
  providers: [UserSessionsRepository, UserSessionsService],
  exports: [UserSessionsService, UserSessionsRepository],
})
export class UserSessionsModule {}
