import { Module } from '@nestjs/common';
import { UserConsentsController } from './user-consents.controller';
import { UserConsentsRepository } from './user-consents.repository';
import { UserConsentsService } from './user-consents.service';

@Module({
  controllers: [UserConsentsController],
  providers: [UserConsentsRepository, UserConsentsService],
  exports: [UserConsentsService, UserConsentsRepository],
})
export class UserConsentsModule {}
