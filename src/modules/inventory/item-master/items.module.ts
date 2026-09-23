import { Module } from '@nestjs/common';
import { DataAccessPoliciesModule } from '@/modules/iam/data-access-policies/data-access-policies.module';
import { CustomFieldsModule } from '@/modules/shared/custom-fields/custom-fields.module';
import { ItemsController } from './items.controller';
import { ItemsRepository } from './items.repository';
import { ItemsService } from './items.service';

@Module({
  imports: [DataAccessPoliciesModule, CustomFieldsModule],
  controllers: [ItemsController],
  providers: [ItemsRepository, ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
