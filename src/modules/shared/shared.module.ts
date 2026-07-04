import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';

@Module({
  imports: [CurrenciesModule],
  exports: [CurrenciesModule],
})
export class SharedModule {}
