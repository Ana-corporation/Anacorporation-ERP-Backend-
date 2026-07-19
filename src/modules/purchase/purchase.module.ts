import { Module } from '@nestjs/common';
import { VendorsModule } from './vendors/vendors.module';

@Module({
  imports: [VendorsModule],
  exports: [VendorsModule],
})
export class PurchaseModule {}
