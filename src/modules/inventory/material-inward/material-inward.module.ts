import { Module } from '@nestjs/common';
import { MaterialInwardController } from './material-inward.controller';
import { MaterialInwardMailController } from './material-inward-mail.controller';
import { MaterialInwardMailService } from './material-inward-mail.service';
import { MaterialInwardService } from './material-inward.service';

@Module({
  controllers: [MaterialInwardController, MaterialInwardMailController],
  providers: [MaterialInwardService, MaterialInwardMailService],
  exports: [MaterialInwardService],
})
export class MaterialInwardModule {}
