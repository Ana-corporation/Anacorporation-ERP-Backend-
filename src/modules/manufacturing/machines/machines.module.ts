import { Module } from '@nestjs/common';
import { ItemsModule } from '@/modules/inventory/item-master/items.module';
import { IdempotencyModule } from '@/modules/shared/idempotency/idempotency.module';
import { BomModule } from '../bom/bom.module';
import { MachinesController } from './machines.controller';
import { MachinesService } from './machines.service';

@Module({
  imports: [ItemsModule, BomModule, IdempotencyModule],
  controllers: [MachinesController],
  providers: [MachinesService],
  exports: [MachinesService],
})
export class MachinesModule {}
