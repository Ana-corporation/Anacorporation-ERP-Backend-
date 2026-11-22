import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateUomDto, UpdateUomDto } from './dto/uom.dto';
import { UomsService } from './uoms.service';

@ApiTags('Units of Measure')
@ApiBearerAuth()
@Controller('companies/:companyId/uoms')
export class UomsController {
  constructor(private readonly uomsService: UomsService) {}

  @Get()
  @RequirePermissions('items:view')
  @ApiOperation({ summary: 'List UOMs (active + inactive, not paginated)' })
  findAll(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.uomsService.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions('items:view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.uomsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('items:create')
  create(@Param('companyId') companyId: string, @Body() dto: CreateUomDto, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.uomsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('items:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.uomsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('items:delete')
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.uomsService.remove(id, companyId, user.sub);
  }
}
