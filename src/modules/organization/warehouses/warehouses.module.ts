import { Module } from '@nestjs/common';
import { StockPostingModule } from '@/modules/inventory/stock/stock-posting.module';
import { BranchesModule } from '../branches/branches.module';
import { WarehousesController } from './warehouses.controller';
import { WarehousesRepository } from './warehouses.repository';
import { WarehousesService } from './warehouses.service';

@Module({
  imports: [BranchesModule, StockPostingModule],
  controllers: [WarehousesController],
  providers: [WarehousesRepository, WarehousesService],
  exports: [WarehousesRepository, WarehousesService],
})
export class WarehousesModule {}
