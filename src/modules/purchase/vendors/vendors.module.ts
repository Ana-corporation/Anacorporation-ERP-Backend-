import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '@/modules/shared/custom-fields/custom-fields.module';
import { ImportsModule } from '@/modules/imports/imports.module';
import { VendorsController } from './vendors.controller';
import { VendorImportController } from './vendor-import.controller';
import { VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';
import { VendorImportService } from './vendor-import.service';

@Module({
  imports: [CustomFieldsModule, ImportsModule],
  controllers: [VendorsController, VendorImportController],
  providers: [VendorsRepository, VendorsService, VendorImportService],
  exports: [VendorsService, VendorImportService],
})
export class VendorsModule {}
