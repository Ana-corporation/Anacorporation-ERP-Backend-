import { Module } from '@nestjs/common';
import { DataAccessPoliciesModule } from '@/modules/iam/data-access-policies/data-access-policies.module';
import {
  MaterialIssuesController,
  OpeningStockController,
  StockAdjustmentsController,
} from './inventory-documents.controllers';
import { InventoryDocumentsRepository } from './inventory-documents.repository';
import { InventoryDocumentsService } from './inventory-documents.service';
import { InventoryLineResolverService } from './inventory-line-resolver.service';
import { StockController } from './stock.controller';
import { StockPostingService } from './stock-posting.service';
import { StockQueryService } from './stock-query.service';

@Module({
  imports: [DataAccessPoliciesModule],
  controllers: [
    OpeningStockController,
    MaterialIssuesController,
    StockAdjustmentsController,
    StockController,
  ],
  providers: [
    InventoryDocumentsRepository,
    InventoryDocumentsService,
    InventoryLineResolverService,
    StockPostingService,
    StockQueryService,
  ],
  /** Future GRN / production / delivery post stock through StockPostingService. */
  exports: [StockPostingService, StockQueryService],
})
export class InventoryStockModule {}
