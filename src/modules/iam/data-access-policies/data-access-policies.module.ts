import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/iam/authentication/auth.module';
import { DataAccessPoliciesController } from './data-access-policies.controller';
import { DataAccessPoliciesRepository } from './data-access-policies.repository';
import { DataAccessPoliciesService } from './data-access-policies.service';

@Module({
  imports: [AuthModule],
  controllers: [DataAccessPoliciesController],
  providers: [DataAccessPoliciesRepository, DataAccessPoliciesService],
  exports: [DataAccessPoliciesRepository, DataAccessPoliciesService],
})
export class DataAccessPoliciesModule {}
