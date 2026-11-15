import { Module } from '@nestjs/common';
import { PurchaseOrdersModule } from './orders/purchase-orders.module';
import { VendorsModule } from './vendors/vendors.module';

@Module({
  imports: [VendorsModule, PurchaseOrdersModule],
  exports: [VendorsModule],
})
export class PurchaseModule {}
