import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { FormConfigurationModule } from './form-configuration/form-configuration.module';
import { GstinModule } from './gstin/gstin.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { NumberSeriesModule } from './number-series/number-series.module';
import { PaymentTermsModule } from './payment-terms/payment-terms.module';
import { TabAccessModule } from './tab-access/tab-access.module';

@Module({
  imports: [
    CurrenciesModule,
    CustomFieldsModule,
    FormConfigurationModule,
    TabAccessModule,
    GstinModule,
    NumberSeriesModule,
    PaymentTermsModule,
    IdempotencyModule,
  ],
  exports: [
    CurrenciesModule,
    CustomFieldsModule,
    FormConfigurationModule,
    TabAccessModule,
    GstinModule,
    NumberSeriesModule,
    PaymentTermsModule,
    IdempotencyModule,
  ],
})
export class SharedModule {}
