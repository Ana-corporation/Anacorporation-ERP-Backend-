import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireModulePermission } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  CreateItemDto,
  UpdateItemDto,
  UpsertItemWarehouseStockDto,
} from './dto/item.dto';
import { ItemsService } from './items.service';

@ApiTags('Item Master')
@ApiBearerAuth()
@Controller('companies/:companyId/items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @ApiOperation({ summary: 'List item master records' })
  @RequireModulePermission('supply-chain', 'view')
  findAll(@Param('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.itemsService.findAll(companyId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one item with warehouse stock' })
  @RequireModulePermission('supply-chain', 'view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.itemsService.findOne(id, companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Create item' })
  @RequireModulePermission('supply-chain', 'create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itemsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update item' })
  @RequireModulePermission('supply-chain', 'edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itemsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete item' })
  @RequireModulePermission('supply-chain', 'delete')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itemsService.remove(id, companyId, user.sub);
  }

  @Put(':id/warehouses')
  @ApiOperation({ summary: 'Create or update item stock row for a warehouse' })
  @RequireModulePermission('supply-chain', 'edit')
  upsertWarehouseStock(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpsertItemWarehouseStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itemsService.upsertWarehouseStock(id, companyId, dto, user.sub);
  }

  @Delete(':id/warehouses/:warehouseId')
  @ApiOperation({ summary: 'Remove item stock row for a warehouse' })
  @RequireModulePermission('supply-chain', 'delete')
  removeWarehouseStock(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itemsService.removeWarehouseStock(id, companyId, warehouseId, user.sub);
  }
}
