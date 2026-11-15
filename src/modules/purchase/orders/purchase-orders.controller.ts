import { Body, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  ApproveDto,
  EmailAttemptListQueryDto,
  PurchaseOrderListQueryDto,
  ReasonDto,
  RejectDto,
  RowVersionDto,
  SavePurchaseOrderDto,
} from './dto/purchase.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

@ApiTags('Purchase orders')
@ApiBearerAuth()
@Controller('companies/:companyId/purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get('email-attempts')
  @RequirePermissions('items:view')
  emailAttempts(
    @Param('companyId') companyId: string,
    @Query() query: EmailAttemptListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.emailAttempts(companyId, query);
  }

  @Get()
  @RequirePermissions('items:view')
  list(
    @Param('companyId') companyId: string,
    @Query() query: PurchaseOrderListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.list(companyId, query, user);
  }

  @Post()
  @RequirePermissions('items:create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: SavePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.create(companyId, dto, user);
  }

  @Get(':id/history')
  @RequirePermissions('items:view')
  history(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.history(companyId, id);
  }

  @Post(':id/submit')
  @RequirePermissions('items:edit')
  submit(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: RowVersionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.submit(companyId, id, dto, user, idempotencyKey);
  }

  @Post(':id/withdraw')
  @RequirePermissions('items:edit')
  withdraw(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: RowVersionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.withdraw(companyId, id, dto, user, idempotencyKey);
  }

  @Post(':id/approve')
  @RequirePermissions('items:approve')
  approve(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: ApproveDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.approve(companyId, id, dto, user, idempotencyKey);
  }

  @Post(':id/reject')
  @RequirePermissions('items:approve')
  reject(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: RejectDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.reject(companyId, id, dto, user, idempotencyKey);
  }

  @Post(':id/amend')
  @RequirePermissions('items:edit')
  amend(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: RowVersionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.amend(companyId, id, dto, user, idempotencyKey);
  }

  @Post(':id/issue')
  @RequirePermissions('items:edit')
  issue(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: RowVersionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.issue(companyId, id, dto, user, idempotencyKey);
  }

  @Post(':id/resend')
  @RequirePermissions('items:edit')
  resend(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: RowVersionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.resend(companyId, id, dto, user, idempotencyKey);
  }

  @Post(':id/close')
  @RequirePermissions('items:edit')
  close(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.close(companyId, id, dto, user, idempotencyKey);
  }

  @Post(':id/cancel')
  @RequirePermissions('items:edit')
  cancel(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.cancel(companyId, id, dto, user, idempotencyKey);
  }

  @Get(':id')
  @RequirePermissions('items:view')
  detail(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.detail(companyId, id, user);
  }

  @Put(':id')
  @RequirePermissions('items:edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: SavePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.orders.update(companyId, id, dto, user);
  }
}
