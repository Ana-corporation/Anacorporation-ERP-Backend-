import { Module } from '@nestjs/common';
import { UserSignaturesController } from './user-signatures.controller';
import { UserSignaturesRepository } from './user-signatures.repository';
import { UserSignaturesService } from './user-signatures.service';

@Module({
  controllers: [UserSignaturesController],
  providers: [UserSignaturesRepository, UserSignaturesService],
  exports: [UserSignaturesService, UserSignaturesRepository],
})
export class UserSignaturesModule {}
