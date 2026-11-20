import { Module } from '@nestjs/common';
import { DataAccessPoliciesModule } from '@/modules/iam/data-access-policies/data-access-policies.module';
import { WarehousesModule } from '@/modules/organization/warehouses/warehouses.module';
import {
  MaterialIssuesController,
  OpeningStockController,
  StockAdjustmentsController,
  StockTransfersController,
} from './inventory-documents.controllers';
import { InventoryDocumentsRepository } from './inventory-documents.repository';
import { InventoryDocumentsService } from './inventory-documents.service';
import { InventoryLineResolverService } from './inventory-line-resolver.service';
import { OpeningStockAttachmentsService } from './opening-stock-attachments.service';
import { StockController } from './stock.controller';
import { StockPostingModule } from './stock-posting.module';
import { StockQueryService } from './stock-query.service';
import { SubcontractorLocationService } from './subcontractor-location.service';

@Module({
  imports: [DataAccessPoliciesModule, WarehousesModule, StockPostingModule],
  controllers: [
    OpeningStockController,
    MaterialIssuesController,
    StockAdjustmentsController,
    StockTransfersController,
    StockController,
  ],
  providers: [
    InventoryDocumentsRepository,
    InventoryDocumentsService,
    InventoryLineResolverService,
    OpeningStockAttachmentsService,
    SubcontractorLocationService,
    StockQueryService,
  ],
  /** Future GRN / production / delivery post stock through StockPostingService. */
  exports: [StockPostingModule, StockQueryService, InventoryDocumentsService, SubcontractorLocationService],
})
export class InventoryStockModule {}
