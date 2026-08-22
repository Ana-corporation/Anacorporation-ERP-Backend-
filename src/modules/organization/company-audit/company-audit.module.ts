import { Module } from '@nestjs/common';
import { CompanyAuditController } from './company-audit.controller';
import { CompanyAuditRepository } from './company-audit.repository';
import { CompanyAuditService } from './company-audit.service';

@Module({
  controllers: [CompanyAuditController],
  providers: [CompanyAuditRepository, CompanyAuditService],
  exports: [CompanyAuditService],
})
export class CompanyAuditModule {}
