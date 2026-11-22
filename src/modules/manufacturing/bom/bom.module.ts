import { Module } from '@nestjs/common';
import { ImportsModule } from '@/modules/imports/imports.module';
import { IdempotencyModule } from '@/modules/shared/idempotency/idempotency.module';
import { NumberSeriesModule } from '@/modules/shared/number-series/number-series.module';
import { BomImportController } from './bom-import.controller';
import { BomImportService } from './bom-import.service';
import { BomLinesService } from './bom-lines.service';
import { BomViewService } from './bom-view.service';
import { BomsController } from './boms.controller';
import { BomsRepository } from './boms.repository';
import { BomsService } from './boms.service';

@Module({
  imports: [NumberSeriesModule, IdempotencyModule, ImportsModule],
  controllers: [BomsController, BomImportController],
  providers: [BomsRepository, BomViewService, BomLinesService, BomsService, BomImportService],
  exports: [BomsService],
})
export class BomModule {}
