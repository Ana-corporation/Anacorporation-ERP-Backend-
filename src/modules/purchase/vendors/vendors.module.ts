import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '@/modules/shared/custom-fields/custom-fields.module';
import { VendorsController } from './vendors.controller';
import { VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';

@Module({
  imports: [CustomFieldsModule],
  controllers: [VendorsController],
  providers: [VendorsRepository, VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
