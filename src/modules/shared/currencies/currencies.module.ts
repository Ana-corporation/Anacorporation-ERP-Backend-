import { Module } from '@nestjs/common';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesRepository } from './currencies.repository';
import { CurrenciesService } from './currencies.service';

@Module({
  controllers: [CurrenciesController],
  providers: [CurrenciesRepository, CurrenciesService],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
