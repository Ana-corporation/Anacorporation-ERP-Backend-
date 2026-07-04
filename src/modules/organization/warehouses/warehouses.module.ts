import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module';
import { WarehousesController } from './warehouses.controller';
import { WarehousesRepository } from './warehouses.repository';
import { WarehousesService } from './warehouses.service';

@Module({
  imports: [BranchesModule],
  controllers: [WarehousesController],
  providers: [WarehousesRepository, WarehousesService],
  exports: [WarehousesRepository, WarehousesService],
})
export class WarehousesModule {}
