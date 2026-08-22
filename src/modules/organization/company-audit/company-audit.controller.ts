import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CompanyAuditService } from './company-audit.service';

@ApiTags('Company Audit Logs')
@ApiBearerAuth()
@Controller('companies/:companyId/audit-logs')
export class CompanyAuditController {
  constructor(private readonly companyAuditService: CompanyAuditService) {}

  @Get()
  @RequirePermissions('user_audit:view')
  @ApiOperation({
    summary: 'List company lifecycle audit events (Platform Owner Activity tab)',
  })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto & { from?: string; to?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.companyAuditService.findAll(companyId, query);
  }
}
