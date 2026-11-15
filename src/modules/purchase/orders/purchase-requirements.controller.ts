import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  BomRunDto,
  ConsolidateDto,
  CreateRequirementDto,
  RequirementListQueryDto,
  RowVersionDto,
  UpdateRequirementDto,
} from './dto/purchase.dto';
import { PurchaseRequirementsService } from './purchase-requirements.service';

@ApiTags('Purchase requirements')
@ApiBearerAuth()
@Controller('companies/:companyId/purchase-requirements')
export class PurchaseRequirementsController {
  constructor(private readonly requirements: PurchaseRequirementsService) {}

  @Get()
  @RequirePermissions('items:view')
  list(
    @Param('companyId') companyId: string,
    @Query() query: RequirementListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.requirements.list(companyId, query);
  }

  @Post('preview-from-bom')
  @RequirePermissions('items:view')
  previewFromBom(
    @Param('companyId') companyId: string,
    @Body() dto: BomRunDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.requirements.previewFromBom(companyId, dto);
  }

  @Post('from-bom')
  @RequirePermissions('items:create')
  fromBom(
    @Param('companyId') companyId: string,
    @Body() dto: BomRunDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.requirements.createFromBom(companyId, dto, user.sub, idempotencyKey);
  }

  @Post('consolidate-preview')
  @RequirePermissions('items:view')
  consolidate(
    @Param('companyId') companyId: string,
    @Body() dto: ConsolidateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.requirements.consolidatePreview(companyId, dto);
  }

  @Post()
  @RequirePermissions('items:create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateRequirementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.requirements.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('items:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.requirements.update(companyId, id, dto, user.sub);
  }

  @Post(':id/cancel')
  @RequirePermissions('items:edit')
  cancel(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: RowVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.requirements.cancel(companyId, id, dto.rowVersion, user.sub);
  }
}
