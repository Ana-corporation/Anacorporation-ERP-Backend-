import { Module } from '@nestjs/common';
import { UserDelegationsController } from './user-delegations.controller';
import { UserDelegationsRepository } from './user-delegations.repository';
import { UserDelegationsService } from './user-delegations.service';

@Module({
  controllers: [UserDelegationsController],
  providers: [UserDelegationsRepository, UserDelegationsService],
  exports: [UserDelegationsService, UserDelegationsRepository],
})
export class UserDelegationsModule {}
