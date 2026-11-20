import { Module } from '@nestjs/common';
import { BomModule } from './bom/bom.module';
import { MachinesModule } from './machines/machines.module';

@Module({
  imports: [BomModule, MachinesModule],
  exports: [BomModule, MachinesModule],
})
export class ManufacturingModule {}
