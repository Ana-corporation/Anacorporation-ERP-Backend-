import { Module } from '@nestjs/common';
import { ItemsModule } from './item-master/items.module';
import { MaterialInwardModule } from './material-inward/material-inward.module';

@Module({
  imports: [ItemsModule, MaterialInwardModule],
  exports: [ItemsModule, MaterialInwardModule],
})
export class InventoryMasterModule {}
