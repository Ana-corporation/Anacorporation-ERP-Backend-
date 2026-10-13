import { Module } from '@nestjs/common';
import { ItemsModule } from './item-master/items.module';
import { InventoryStockModule } from './stock/inventory-stock.module';

@Module({
  imports: [ItemsModule, InventoryStockModule],
  exports: [ItemsModule, InventoryStockModule],
})
export class InventoryMasterModule {}
