import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateStoreCategoryDto, UpdateStoreCategoryDto } from './dto/store-category.dto';
import { StoreCategoriesService } from './store-categories.service';

@ApiTags('Store Categories')
@ApiBearerAuth()
@Controller('companies/:companyId/store-categories')
export class StoreCategoriesController {
  constructor(private readonly storeCategoriesService: StoreCategoriesService) {}

  @Get()
  @RequirePermissions('warehouses:view')
  @ApiOperation({ summary: 'List store categories (active + inactive, not paginated)' })
  findAll(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.storeCategoriesService.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions('warehouses:view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.storeCategoriesService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('warehouses:create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateStoreCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.storeCategoriesService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('warehouses:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStoreCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.storeCategoriesService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('warehouses:delete')
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.storeCategoriesService.remove(id, companyId, user.sub);
  }
}
