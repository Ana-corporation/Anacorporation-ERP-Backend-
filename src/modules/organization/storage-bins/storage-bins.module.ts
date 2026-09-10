import { Module } from '@nestjs/common';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { StorageBinsController } from './storage-bins.controller';
import { StorageBinsRepository } from './storage-bins.repository';
import { StorageBinsService } from './storage-bins.service';

@Module({
  imports: [WarehousesModule],
  controllers: [StorageBinsController],
  providers: [StorageBinsRepository, StorageBinsService],
  exports: [StorageBinsRepository, StorageBinsService],
})
export class StorageBinsModule {}
