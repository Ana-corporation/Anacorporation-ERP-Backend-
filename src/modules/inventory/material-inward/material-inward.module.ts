import { Module } from '@nestjs/common';
import { MaterialInwardController } from './material-inward.controller';
import { MaterialInwardService } from './material-inward.service';

@Module({
  controllers: [MaterialInwardController],
  providers: [MaterialInwardService],
  exports: [MaterialInwardService],
})
export class MaterialInwardModule {}
