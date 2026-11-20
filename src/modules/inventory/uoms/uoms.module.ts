import { Module } from '@nestjs/common';
import { UomsController } from './uoms.controller';
import { UomsService } from './uoms.service';

@Module({
  controllers: [UomsController],
  providers: [UomsService],
  exports: [UomsService],
})
export class UomsModule {}
