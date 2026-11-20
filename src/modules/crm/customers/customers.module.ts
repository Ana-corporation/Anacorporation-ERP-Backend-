import { Module } from '@nestjs/common';
import { GstinModule } from '@/modules/shared/gstin/gstin.module';
import { NumberSeriesModule } from '@/modules/shared/number-series/number-series.module';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';

@Module({
  imports: [GstinModule, NumberSeriesModule],
  controllers: [CustomersController],
  providers: [CustomersRepository, CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
