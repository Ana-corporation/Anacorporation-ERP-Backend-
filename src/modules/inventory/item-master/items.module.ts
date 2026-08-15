import { Module } from '@nestjs/common';
import { DataAccessPoliciesModule } from '@/modules/iam/data-access-policies/data-access-policies.module';
import { ItemsController } from './items.controller';
import { ItemsRepository } from './items.repository';
import { ItemsService } from './items.service';

@Module({
  imports: [DataAccessPoliciesModule],
  controllers: [ItemsController],
  providers: [ItemsRepository, ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
