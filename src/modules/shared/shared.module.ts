import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { FormConfigurationModule } from './form-configuration/form-configuration.module';
import { TabAccessModule } from './tab-access/tab-access.module';

@Module({
  imports: [CurrenciesModule, CustomFieldsModule, FormConfigurationModule, TabAccessModule],
  exports: [CurrenciesModule, CustomFieldsModule, FormConfigurationModule, TabAccessModule],
})
export class SharedModule {}
