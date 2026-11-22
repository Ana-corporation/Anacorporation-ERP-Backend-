import { Module } from '@nestjs/common';
import { ImportsModule } from '@/modules/imports/imports.module';
import { NumberSeriesModule } from '@/modules/shared/number-series/number-series.module';
import { ItemsModule } from '../item-master/items.module';
import { InventoryStockModule } from '../stock/inventory-stock.module';
import { OpeningStockImportController } from './opening-stock-import.controller';
import { OpeningStockImportService } from './opening-stock-import.service';

@Module({
  imports: [ImportsModule, ItemsModule, InventoryStockModule, NumberSeriesModule],
  controllers: [OpeningStockImportController],
  providers: [OpeningStockImportService],
})
export class OpeningStockImportModule {}
