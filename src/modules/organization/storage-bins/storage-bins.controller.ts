import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  BulkCreateStorageBinsDto,
  CreateStorageBinDto,
  StorageBinListQueryDto,
  UpdateStorageBinDto,
} from './dto/storage-bin.dto';
import { StorageBinsService } from './storage-bins.service';

@ApiTags('Storage Bins')
@ApiBearerAuth()
@Controller('companies/:companyId/storage-bins')
export class StorageBinsController {
  constructor(private readonly storageBinsService: StorageBinsService) {}

  @Get()
  @RequirePermissions('warehouses:view')
  @ApiOperation({
    summary: 'List storage bins (Phase 1A — reuses warehouses:view)',
    description:
      'Filter by inventoryLocationId. limit max 500 (default 20). sortBy=binCode uses natural order (A1-01…A1-200).',
  })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: StorageBinListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.storageBinsService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('warehouses:view')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.storageBinsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('warehouses:create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateStorageBinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.storageBinsService.create(companyId, dto, user.sub);
  }

  @Post('bulk')
  @RequirePermissions('warehouses:create')
  @ApiOperation({ summary: 'Create up to 500 bins in one location (one transaction)' })
  bulkCreate(
    @Param('companyId') companyId: string,
    @Body() dto: BulkCreateStorageBinsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.storageBinsService.bulkCreate(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('warehouses:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStorageBinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.storageBinsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('warehouses:delete')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.storageBinsService.remove(id, companyId, user.sub);
  }
}
