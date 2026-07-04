import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryRepository, InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryRepository, InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
