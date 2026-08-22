import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { VendorListQueryDto } from './dto/vendor-list-query.dto';
import { VendorsService } from './vendors.service';

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('companies/:companyId/vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @RequirePermissions('vendors:view')
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: VendorListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('vendors:view')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('vendors:create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('vendors:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('vendors:delete')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.vendorsService.remove(id, companyId, user.sub);
  }
}
