import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import {
  CreateInventoryItemDto,
  CreateWarehouseDto,
  InventoryTransactionDto,
} from './dto/inventory.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { RequireModulePermission, RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser, OrganizationId } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('warehouses')
  @RequirePermissions('inventory:read')
  @RequireModulePermission('supply-chain', 'view')
  @ApiOperation({ summary: 'List warehouses' })
  listWarehouses(@OrganizationId() organizationId: string) {
    return this.inventoryService.listWarehouses(organizationId);
  }

  @Post('warehouses')
  @RequirePermissions('inventory:write')
  @RequireModulePermission('supply-chain', 'create')
  @ApiOperation({ summary: 'Create warehouse' })
  createWarehouse(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWarehouseDto,
  ) {
    return this.inventoryService.createWarehouse(organizationId, dto, user.sub);
  }

  @Get('items')
  @RequirePermissions('inventory:read')
  @RequireModulePermission('supply-chain', 'view')
  @ApiOperation({ summary: 'List inventory items' })
  listItems(@OrganizationId() organizationId: string, @Query() query: PaginationQueryDto) {
    return this.inventoryService.listItems(organizationId, query);
  }

  @Get('items/:id')
  @RequirePermissions('inventory:read')
  @RequireModulePermission('supply-chain', 'view')
  @ApiOperation({ summary: 'Get inventory item' })
  getItem(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.inventoryService.getItem(organizationId, id);
  }

  @Post('items')
  @RequirePermissions('inventory:write')
  @RequireModulePermission('supply-chain', 'create')
  @ApiOperation({ summary: 'Create inventory item' })
  createItem(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInventoryItemDto,
  ) {
    return this.inventoryService.createItem(organizationId, dto, user.sub);
  }

  @Post('transactions')
  @RequirePermissions('inventory:write')
  @RequireModulePermission('supply-chain', 'edit')
  @ApiOperation({ summary: 'Record inventory transaction' })
  recordTransaction(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InventoryTransactionDto,
  ) {
    return this.inventoryService.recordTransaction(organizationId, dto, user.sub);
  }

  @Get('items/:id/transactions')
  @RequirePermissions('inventory:read')
  @RequireModulePermission('supply-chain', 'view')
  @ApiOperation({ summary: 'Get inventory transaction history' })
  getTransactions(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.inventoryService.getTransactions(organizationId, id);
  }
}
