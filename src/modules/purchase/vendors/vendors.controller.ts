import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser, OrganizationId } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @RequirePermissions('vendors:read')
  findAll(@OrganizationId() organizationId: string, @Query() query: PaginationQueryDto) {
    return this.vendorsService.findAll(organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('vendors:read')
  findOne(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.vendorsService.findOne(organizationId, id);
  }

  @Post()
  @RequirePermissions('vendors:write')
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVendorDto,
  ) {
    return this.vendorsService.create(organizationId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('vendors:write')
  update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return this.vendorsService.update(organizationId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('vendors:write')
  remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.vendorsService.remove(organizationId, id, user.sub);
  }
}
