import { Module } from '@nestjs/common';
import { StockPostingService } from './stock-posting.service';

/** Shared stock write path — imported by inventory docs and warehouse bin-mgmt migration. */
@Module({
  providers: [StockPostingService],
  exports: [StockPostingService],
})
export class StockPostingModule {}
