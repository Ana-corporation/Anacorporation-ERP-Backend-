import { Module } from '@nestjs/common';
import { UserMfaController } from './user-mfa.controller';
import { UserMfaRepository } from './user-mfa.repository';
import { UserMfaService } from './user-mfa.service';

@Module({
  controllers: [UserMfaController],
  providers: [UserMfaRepository, UserMfaService],
  exports: [UserMfaService, UserMfaRepository],
})
export class UserMfaModule {}
