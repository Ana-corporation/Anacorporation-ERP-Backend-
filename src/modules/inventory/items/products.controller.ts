import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { RequireModulePermission, RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser, OrganizationId } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('products:read')
  @RequireModulePermission('supply-chain', 'view')
  findAll(@OrganizationId() organizationId: string, @Query() query: PaginationQueryDto) {
    return this.productsService.findAll(organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('products:read')
  @RequireModulePermission('supply-chain', 'view')
  findOne(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.productsService.findOne(organizationId, id);
  }

  @Post()
  @RequirePermissions('products:write')
  @RequireModulePermission('supply-chain', 'create')
  create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(organizationId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('products:write')
  @RequireModulePermission('supply-chain', 'edit')
  update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(organizationId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('products:write')
  @RequireModulePermission('supply-chain', 'delete')
  remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.productsService.remove(organizationId, id, user.sub);
  }
}
