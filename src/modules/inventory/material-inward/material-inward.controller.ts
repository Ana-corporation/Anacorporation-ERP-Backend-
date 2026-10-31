import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  AddCaseLinesDto,
  CompleteQcDto,
  ConfirmPutawayDto,
  AttachmentDto,
  CreateLocationDto,
  CreatePurchaseOrderDto,
  CreateReturnDto,
  ExcessDecisionDto,
  InvoiceMatchDto,
  SaveGrnDto,
  ShortCloseDto,
} from './dto/material-inward.dto';
import { MaterialInwardService } from './material-inward.service';

@ApiTags('Material Inward')
@ApiBearerAuth()
@Controller('companies/:companyId/material-inward')
export class MaterialInwardController {
  constructor(private readonly inward: MaterialInwardService) {}

  @Get('tasks/mine')
  @RequirePermissions('items:view')
  @ApiOperation({ summary: 'Open material-inward tasks and role counts' })
  tasks(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.inward.tasks(companyId, user.sub);
  }

  @Get('config')
  @RequirePermissions('items:view')
  config(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.inward.config(companyId);
  }

  @Get('documents/:docType/:id/attachments')
  @RequirePermissions('items:view')
  listAttachments(
    @Param('companyId') companyId: string,
    @Param('docType') docType: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.listAttachments(companyId, docType, id);
  }

  @Post('attachments')
  @RequirePermissions('items:edit')
  addAttachment(
    @Param('companyId') companyId: string,
    @Body() dto: AttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.addAttachment(companyId, dto, user.sub);
  }

  @Get('rejection-reasons')
  @RequirePermissions('items:view')
  reasons(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.inward.reasons(companyId);
  }

  @Get('resolution-types')
  @RequirePermissions('items:view')
  resolutions(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.inward.resolutions(companyId);
  }

  @Get('locations')
  @RequirePermissions('items:view')
  locations(
    @Param('companyId') companyId: string,
    @Query('warehouseId') warehouseId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.listLocations(companyId, warehouseId);
  }

  @Post('locations')
  @RequirePermissions('items:edit')
  createLocation(
    @Param('companyId') companyId: string,
    @Body() dto: CreateLocationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.createLocation(companyId, dto, user.sub);
  }

  @Get('purchase-orders')
  @RequirePermissions('items:view')
  listPurchaseOrders(
    @Param('companyId') companyId: string,
    @Query('outstandingOnly') outstandingOnly: string | undefined,
    @Query('poNo') poNo: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.listPurchaseOrders(companyId, outstandingOnly, poNo);
  }

  @Post('purchase-orders')
  @RequirePermissions('items:edit')
  createPurchaseOrder(
    @Param('companyId') companyId: string,
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.createPurchaseOrder(companyId, dto, user.sub);
  }

  @Post('purchase-orders/lines/:lineId/short-close')
  @RequirePermissions('items:edit')
  shortClose(
    @Param('companyId') companyId: string,
    @Param('lineId') lineId: string,
    @Body() dto: ShortCloseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.shortClose(companyId, lineId, dto, user.sub);
  }

  @Get('purchase-orders/:id')
  @RequirePermissions('items:view')
  getPurchaseOrder(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.getPurchaseOrder(companyId, id);
  }

  @Get('grn')
  @RequirePermissions('items:view')
  listGrn(
    @Param('companyId') companyId: string,
    @Query('status') status: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.listGrn(companyId, status);
  }

  @Post('grn')
  @RequirePermissions('items:edit')
  createGrn(
    @Param('companyId') companyId: string,
    @Body() dto: SaveGrnDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.saveGrn(companyId, dto, user.sub);
  }

  @Get('grn/:id')
  @RequirePermissions('items:view')
  getGrn(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.getGrn(companyId, id);
  }

  @Put('grn/:id')
  @RequirePermissions('items:edit')
  updateGrn(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: SaveGrnDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.saveGrn(companyId, dto, user.sub, id);
  }

  @Post('grn/:id/submit')
  @RequirePermissions('items:edit')
  submitGrn(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.submitGrn(companyId, id, user.sub);
  }

  @Post('grn/:id/reverse')
  @RequirePermissions('items:edit')
  reverseGrn(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.reverseGrn(companyId, id, user.sub);
  }

  @Post('grn/:id/excess-decision')
  @RequirePermissions('items:edit')
  excess(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: ExcessDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.excessDecision(companyId, id, dto, user.sub);
  }

  @Get('qc')
  @RequirePermissions('items:view')
  listQc(
    @Param('companyId') companyId: string,
    @Query('status') status: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.listQc(companyId, status);
  }

  @Post('qc/:id/start')
  @RequirePermissions('items:edit')
  startQc(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.startQc(companyId, id, user.sub);
  }

  @Post('qc/:id/complete')
  @RequirePermissions('items:edit')
  completeQc(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: CompleteQcDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.completeQc(companyId, id, dto, user.sub);
  }

  @Get('supplier-cases')
  @RequirePermissions('items:view')
  cases(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.inward.listCases(companyId);
  }

  @Post('supplier-cases/:id/lines')
  @RequirePermissions('items:edit')
  addCaseLines(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: AddCaseLinesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.addCaseLines(companyId, id, dto, user.sub);
  }

  @Post('supplier-cases/:id/lines/:lineId/use-as-is')
  @RequirePermissions('items:edit')
  useAsIs(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.useAsIs(companyId, id, lineId, user.sub);
  }

  @Post('returns')
  @RequirePermissions('items:edit')
  createReturn(
    @Param('companyId') companyId: string,
    @Body() dto: CreateReturnDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.createReturn(companyId, dto, user.sub);
  }

  @Post('returns/:id/post')
  @RequirePermissions('items:edit')
  postReturn(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.postReturn(companyId, id, user.sub);
  }

  @Get('putaway')
  @RequirePermissions('items:view')
  listPutaway(
    @Param('companyId') companyId: string,
    @Query('status') status: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.listPutaway(companyId, status);
  }

  @Post('putaway/:id/confirm')
  @RequirePermissions('items:edit')
  confirmPutaway(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: ConfirmPutawayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.confirmPutaway(companyId, id, dto, user.sub);
  }

  @Get('inventory/balances')
  @RequirePermissions('items:view')
  balances(
    @Param('companyId') companyId: string,
    @Query('itemId') itemId: string | undefined,
    @Query('status') status: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.balances(companyId, itemId, status);
  }

  @Get('inventory/ledger')
  @RequirePermissions('items:view')
  ledger(
    @Param('companyId') companyId: string,
    @Query('itemId') itemId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.ledger(companyId, itemId);
  }

  @Get('invoice-match/uninvoiced')
  @RequirePermissions('items:view')
  uninvoiced(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.inward.uninvoiced(companyId);
  }

  @Post('invoice-match')
  @RequirePermissions('items:edit')
  match(
    @Param('companyId') companyId: string,
    @Body() dto: InvoiceMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.matchInvoice(companyId, dto, user.sub);
  }

  @Get('documents/:docType/:id/activity')
  @RequirePermissions('items:view')
  activity(
    @Param('companyId') companyId: string,
    @Param('docType') docType: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.activity(companyId, docType.toUpperCase(), id);
  }

  @Get('trace/:docType/:id')
  @RequirePermissions('items:view')
  trace(
    @Param('companyId') companyId: string,
    @Param('docType') docType: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.inward.trace(companyId, docType, id);
  }
}
