import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CurrentStockQueryDto, StockLedgerQueryDto } from './dto/stock-query.dto';
import { StockQueryService } from './stock-query.service';

/** Read-only by design: stock changes only through posted inventory documents. */
@ApiTags('Inventory — Stock')
@ApiBearerAuth()
@Controller('companies/:companyId/inventory/stock')
export class StockController {
  constructor(private readonly stockQueryService: StockQueryService) {}

  @Get()
  @RequirePermissions('inventory_stock:view')
  @ApiOperation({ summary: 'Current stock per item / site / location / bin' })
  currentStock(
    @Param('companyId') companyId: string,
    @Query() query: CurrentStockQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.stockQueryService.currentStock(companyId, user.sub, query);
  }

  @Get('ledger')
  @RequirePermissions('inventory_stock:view')
  @ApiOperation({ summary: 'Stock ledger with running balance (includes balance before fromDate)' })
  ledger(
    @Param('companyId') companyId: string,
    @Query() query: StockLedgerQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.stockQueryService.ledger(companyId, user.sub, query);
  }
}
