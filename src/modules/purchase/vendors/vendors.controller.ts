import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireModulePermission } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { VendorsService } from './vendors.service';

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('companies/:companyId/vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @RequireModulePermission('supply-chain', 'view')
  findAll(@Param('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.vendorsService.findAll(companyId, query);
  }

  @Get(':id')
  @RequireModulePermission('supply-chain', 'view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.vendorsService.findOne(id, companyId);
  }

  @Post()
  @RequireModulePermission('supply-chain', 'create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequireModulePermission('supply-chain', 'edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequireModulePermission('supply-chain', 'delete')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.remove(id, companyId, user.sub);
  }
}
