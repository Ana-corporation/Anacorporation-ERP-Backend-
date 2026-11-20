import { Module } from '@nestjs/common';
import { DataAccessPoliciesModule } from '@/modules/iam/data-access-policies/data-access-policies.module';
import { ImportsModule } from '@/modules/imports/imports.module';
import { CustomFieldsModule } from '@/modules/shared/custom-fields/custom-fields.module';
import { FormConfigurationModule } from '@/modules/shared/form-configuration/form-configuration.module';
import { NumberSeriesModule } from '@/modules/shared/number-series/number-series.module';
import { ItemImportController } from './item-import.controller';
import { ItemImportService } from './item-import.service';
import { ItemsController } from './items.controller';
import { ItemsRepository } from './items.repository';
import { ItemsService } from './items.service';
import { ItemsLookupService } from './items-lookup.service';

@Module({
  imports: [
    DataAccessPoliciesModule,
    CustomFieldsModule,
    FormConfigurationModule,
    NumberSeriesModule,
    ImportsModule,
  ],
  controllers: [ItemsController, ItemImportController],
  providers: [ItemsRepository, ItemsService, ItemsLookupService, ItemImportService],
  exports: [ItemsService, ItemsLookupService],
})
export class ItemsModule {}
