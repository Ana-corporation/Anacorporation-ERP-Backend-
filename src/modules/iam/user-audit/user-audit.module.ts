import { Module } from '@nestjs/common';
import { UserAuditController } from './user-audit.controller';
import { UserAuditRepository } from './user-audit.repository';
import { UserAuditService } from './user-audit.service';

@Module({
  controllers: [UserAuditController],
  providers: [UserAuditRepository, UserAuditService],
  exports: [UserAuditService, UserAuditRepository],
})
export class UserAuditModule {}
