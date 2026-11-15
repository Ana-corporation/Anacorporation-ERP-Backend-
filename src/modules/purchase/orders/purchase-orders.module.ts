import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseRequirementsController } from './purchase-requirements.controller';
import { PurchaseRequirementsService } from './purchase-requirements.service';
import { PurchaseSettingsController } from './purchase-settings.controller';
import { PurchaseSettingsService } from './purchase-settings.service';

@Module({
  controllers: [PurchaseRequirementsController, PurchaseOrdersController, PurchaseSettingsController],
  providers: [PurchaseRequirementsService, PurchaseOrdersService, PurchaseSettingsService],
})
export class PurchaseOrdersModule {}
