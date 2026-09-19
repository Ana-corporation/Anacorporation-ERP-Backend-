import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { VerifyGstinDto } from './dto/verify-gstin.dto';
import { GstinService } from './gstin.service';

@ApiTags('GSTIN')
@ApiBearerAuth()
@Controller('companies/:companyId/gstin')
export class GstinController {
  constructor(private readonly gstinService: GstinService) {}

  @Post('verify')
  @RequirePermissions('vendors:view')
  @ApiOperation({
    summary:
      'Verify an Indian GSTIN (gstinapi.in). Enabled for allow-listed companies (default ANA_MACHINERY_P_LTD).',
  })
  verify(
    @Param('companyId') companyId: string,
    @Body() dto: VerifyGstinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.gstinService.verifyForCompany(companyId, dto);
  }
}
