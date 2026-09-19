import { Module } from '@nestjs/common';
import { GstinController } from './gstin.controller';
import { GstinService } from './gstin.service';

@Module({
  controllers: [GstinController],
  providers: [GstinService],
  exports: [GstinService],
})
export class GstinModule {}
