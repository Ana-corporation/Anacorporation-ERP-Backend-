import { Module } from '@nestjs/common';
import { NumberSeriesModule } from '@/modules/shared/number-series/number-series.module';
import { EmployeesController } from './employees.controller';
import { EmployeesRepository } from './employees.repository';
import { EmployeesService } from './employees.service';

@Module({
  imports: [NumberSeriesModule],
  controllers: [EmployeesController],
  providers: [EmployeesRepository, EmployeesService],
  exports: [EmployeesService, EmployeesRepository],
})
export class EmployeesModule {}
