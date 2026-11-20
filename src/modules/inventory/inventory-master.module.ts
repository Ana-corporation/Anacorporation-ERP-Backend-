import { Module } from '@nestjs/common';
import { ItemGroupsModule } from './item-groups/item-groups.module';
import { ItemsModule } from './item-master/items.module';
import { MaterialInwardModule } from './material-inward/material-inward.module';
import { OpeningStockImportModule } from './opening-stock-import/opening-stock-import.module';
import { InventoryStockModule } from './stock/inventory-stock.module';
import { UomsModule } from './uoms/uoms.module';

@Module({
  imports: [
    ItemsModule,
    ItemGroupsModule,
    UomsModule,
    InventoryStockModule,
    OpeningStockImportModule,
    MaterialInwardModule,
  ],
  exports: [ItemsModule, ItemGroupsModule, UomsModule, InventoryStockModule, MaterialInwardModule],
})
export class InventoryMasterModule {}
