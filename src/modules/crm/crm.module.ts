import { Module } from '@nestjs/common';
import { CustomersModule } from './customers/customers.module';

@Module({
  imports: [CustomersModule],
  exports: [CustomersModule],
})
export class CrmModule {}
