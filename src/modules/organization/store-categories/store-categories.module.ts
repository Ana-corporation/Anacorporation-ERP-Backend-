import { Module } from '@nestjs/common';
import { StoreCategoriesController } from './store-categories.controller';
import { StoreCategoriesRepository } from './store-categories.repository';
import { StoreCategoriesService } from './store-categories.service';

@Module({
  controllers: [StoreCategoriesController],
  providers: [StoreCategoriesRepository, StoreCategoriesService],
  exports: [StoreCategoriesRepository, StoreCategoriesService],
})
export class StoreCategoriesModule {}
