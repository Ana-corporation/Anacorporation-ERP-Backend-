import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateItemGroupDto, ItemGroupListQueryDto, UpdateItemGroupDto } from './dto/item-group.dto';
import { ItemGroupsService } from './item-groups.service';

@ApiTags('Item Groups')
@ApiBearerAuth()
@Controller('companies/:companyId/item-groups')
export class ItemGroupsController {
  constructor(private readonly itemGroupsService: ItemGroupsService) {}

  @Get()
  @RequirePermissions('items:view')
  @ApiOperation({ summary: 'Flat list in tree order (depth + path). Filter by storeCategoryId.' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: ItemGroupListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemGroupsService.findAll(companyId, query);
  }

  @Get('tree')
  @RequirePermissions('items:view')
  @ApiOperation({ summary: 'Nested tree for the group picker. Filter by storeCategoryId.' })
  tree(
    @Param('companyId') companyId: string,
    @Query() query: ItemGroupListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemGroupsService.tree(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('items:view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.itemGroupsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('items:create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateItemGroupDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemGroupsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('items:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItemGroupDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemGroupsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('items:delete')
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.itemGroupsService.remove(id, companyId, user.sub);
  }
}
