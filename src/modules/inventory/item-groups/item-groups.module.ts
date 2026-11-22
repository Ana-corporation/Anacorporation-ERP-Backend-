import { Module } from '@nestjs/common';
import { ItemGroupsController } from './item-groups.controller';
import { ItemGroupsRepository } from './item-groups.repository';
import { ItemGroupsService } from './item-groups.service';

@Module({
  controllers: [ItemGroupsController],
  providers: [ItemGroupsRepository, ItemGroupsService],
  exports: [ItemGroupsService],
})
export class ItemGroupsModule {}
