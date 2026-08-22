import { Module } from '@nestjs/common';
import { RolesModule } from '@/modules/iam/roles/roles.module';
import { CompaniesController } from './companies.controller';
import { CompaniesRepository } from './companies.repository';
import { CompaniesService } from './companies.service';

@Module({
  imports: [RolesModule],
  controllers: [CompaniesController],
  providers: [CompaniesRepository, CompaniesService],
  exports: [CompaniesService, CompaniesRepository],
})
export class CompaniesModule {}
