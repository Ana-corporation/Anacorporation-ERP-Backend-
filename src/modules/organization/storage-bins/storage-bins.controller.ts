import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateStorageBinDto, UpdateStorageBinDto } from './dto/storage-bin.dto';
import { StorageBinsService } from './storage-bins.service';

@ApiTags('Storage Bins')
@ApiBearerAuth()
@Controller('companies/:companyId/storage-bins')
export class StorageBinsController {
  constructor(private readonly storageBinsService: StorageBinsService) {}

  @Get()
  @RequirePermissions('warehouses:view')
  @ApiOperation({ summary: 'List storage bins (Phase 1A — reuses warehouses:view)' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
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
