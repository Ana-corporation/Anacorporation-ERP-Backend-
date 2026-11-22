import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  NumberSeriesAuditQueryDto,
  NumberSeriesPreviewQueryDto,
  UpdateNumberSeriesDto,
} from './dto/number-series.dto';
import { NumberSeriesService } from './number-series.service';

@ApiTags('Number Series')
@ApiBearerAuth()
@Controller('companies/:companyId/number-series')
export class NumberSeriesController {
  constructor(private readonly numberSeriesService: NumberSeriesService) {}

  @Get()
  @RequirePermissions('number_series:view')
  @ApiOperation({ summary: 'Document types that support a number series (only ITEM for now)' })
  list(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.numberSeriesService.list(companyId);
  }

  @Get(':documentType')
  @RequirePermissions('number_series:view')
  @ApiOperation({ summary: 'Series settings plus one line per store category, with the next number' })
  get(
    @Param('companyId') companyId: string,
    @Param('documentType') documentType: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.numberSeriesService.get(companyId, documentType);
  }

  @Put(':documentType')
  @RequirePermissions('number_series:edit')
  @ApiOperation({ summary: 'Save the series settings and store lines (one transaction)' })
  update(
    @Param('companyId') companyId: string,
    @Param('documentType') documentType: string,
    @Body() dto: UpdateNumberSeriesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.numberSeriesService.update(companyId, documentType, dto, user.sub);
  }

  @Get(':documentType/preview')
  @RequirePermissions('number_series:view')
  @ApiOperation({ summary: 'Next number for a store without using it up' })
  preview(
    @Param('companyId') companyId: string,
    @Param('documentType') documentType: string,
    @Query() query: NumberSeriesPreviewQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.numberSeriesService.preview(companyId, documentType, query.segmentRefId);
  }

  @Get(':documentType/audit')
  @RequirePermissions('number_series:view')
  @ApiOperation({ summary: 'Change history of the series settings (one row per changed field)' })
  audit(
    @Param('companyId') companyId: string,
    @Param('documentType') documentType: string,
    @Query() query: NumberSeriesAuditQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    this.numberSeriesService.parseDocumentType(documentType);
    return this.numberSeriesService.auditLog(companyId, query);
  }
}
