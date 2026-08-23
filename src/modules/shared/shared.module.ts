import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { FormConfigurationModule } from './form-configuration/form-configuration.module';

@Module({
  imports: [CurrenciesModule, CustomFieldsModule, FormConfigurationModule],
  exports: [CurrenciesModule, CustomFieldsModule, FormConfigurationModule],
})
export class SharedModule {}
