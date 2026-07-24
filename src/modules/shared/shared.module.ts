import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';

@Module({
  imports: [CurrenciesModule, CustomFieldsModule],
  exports: [CurrenciesModule, CustomFieldsModule],
})
export class SharedModule {}
