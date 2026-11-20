import { Module } from '@nestjs/common';
import { DocumentNumberService } from './document-number.service';
import { NumberSeriesController } from './number-series.controller';
import { NumberSeriesRepository } from './number-series.repository';
import { NumberSeriesService } from './number-series.service';
import { PartNumberGeneratorService } from './part-number-generator.service';

@Module({
  controllers: [NumberSeriesController],
  providers: [NumberSeriesRepository, NumberSeriesService, PartNumberGeneratorService, DocumentNumberService],
  exports: [PartNumberGeneratorService, DocumentNumberService],
})
export class NumberSeriesModule {}
