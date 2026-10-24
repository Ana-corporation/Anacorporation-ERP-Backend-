import { Module } from '@nestjs/common';
import { ItemsModule } from './item-master/items.module';
import { InventoryStockModule } from './stock/inventory-stock.module';
import { MaterialInwardModule } from './material-inward/material-inward.module';

@Module({
  imports: [ItemsModule, InventoryStockModule, MaterialInwardModule],
  exports: [ItemsModule, InventoryStockModule, MaterialInwardModule],
})
export class InventoryMasterModule {}
