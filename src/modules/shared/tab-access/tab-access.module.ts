import { Module } from '@nestjs/common';
import { TabAccessController } from './tab-access.controller';
import { TabAccessRepository } from './tab-access.repository';
import { TabAccessService } from './tab-access.service';

@Module({
  controllers: [TabAccessController],
  providers: [TabAccessRepository, TabAccessService],
  exports: [TabAccessService],
})
export class TabAccessModule {}
