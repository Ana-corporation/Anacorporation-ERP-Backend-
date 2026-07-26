import { Module } from '@nestjs/common';
import { ItemsModule } from './item-master/items.module';

@Module({
  imports: [ItemsModule],
  exports: [ItemsModule],
})
export class InventoryMasterModule {}
