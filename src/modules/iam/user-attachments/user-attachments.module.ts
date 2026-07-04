import { Module } from '@nestjs/common';
import { UserAttachmentsController } from './user-attachments.controller';
import { UserAttachmentsRepository } from './user-attachments.repository';
import { UserAttachmentsService } from './user-attachments.service';

@Module({
  controllers: [UserAttachmentsController],
  providers: [UserAttachmentsRepository, UserAttachmentsService],
  exports: [UserAttachmentsService, UserAttachmentsRepository],
})
export class UserAttachmentsModule {}
