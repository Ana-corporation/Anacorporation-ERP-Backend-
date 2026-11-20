import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreatePaymentTermDto, UpdatePaymentTermDto } from './dto/payment-term.dto';
import { PaymentTermsService } from './payment-terms.service';

@ApiTags('Payment Terms')
@ApiBearerAuth()
@Controller('companies/:companyId/payment-terms')
export class PaymentTermsController {
  constructor(private readonly paymentTermsService: PaymentTermsService) {}

  @Get()
  @RequirePermissions('payment_terms:view')
  @ApiOperation({ summary: 'List payment terms (active + inactive, not paginated)' })
  findAll(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.paymentTermsService.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions('payment_terms:view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.paymentTermsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('payment_terms:create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreatePaymentTermDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.paymentTermsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('payment_terms:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentTermDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.paymentTermsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('payment_terms:delete')
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.paymentTermsService.remove(id, companyId, user.sub);
  }
}
