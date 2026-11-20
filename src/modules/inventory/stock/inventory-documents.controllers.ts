import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryDocumentType } from '@prisma/client';
import { memoryStorage } from 'multer';
import { ITEM_ATTACHMENT_MAX_BYTES } from '@/modules/inventory/item-master/item-attachments.constants';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import {
  InventoryDocumentListQueryDto,
  MaterialIssueDto,
  OpeningStockDto,
  StockAdjustmentDto,
  StockTransferDto,
} from './dto/inventory-document.dto';
import { InventoryDocumentsService } from './inventory-documents.service';
import { OpeningStockAttachmentsService } from './opening-stock-attachments.service';

type UploadedAttachment = { originalname: string; mimetype?: string; size: number; buffer: Buffer };

/** Post = :approve. Posted documents are locked: PUT / DELETE / POST again → 409. */

@ApiTags('Inventory — Opening Stock')
@ApiBearerAuth()
@Controller('companies/:companyId/inventory/opening-stock')
export class OpeningStockController {
  private readonly type = InventoryDocumentType.OPENING_STOCK;
  constructor(
    private readonly service: InventoryDocumentsService,
    private readonly attachments: OpeningStockAttachmentsService,
  ) {}

  @Post(':id/attachments')
  @RequirePermissions('opening_stock:edit')
  @ApiOperation({ summary: 'Upload count sheets / verification files (draft or posted)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'files', maxCount: 10 },
        { name: 'file', maxCount: 10 },
      ],
      { storage: memoryStorage(), limits: { fileSize: ITEM_ATTACHMENT_MAX_BYTES } },
    ),
  )
  uploadAttachments(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @UploadedFiles() uploaded: { files?: UploadedAttachment[]; file?: UploadedAttachment[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.attachments.upload(companyId, id, [...(uploaded?.files ?? []), ...(uploaded?.file ?? [])], user.sub);
  }

  @Get(':id/attachments/:fileAssetId/url')
  @RequirePermissions('opening_stock:view')
  attachmentUrl(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('fileAssetId') fileAssetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.attachments.signedUrl(companyId, id, fileAssetId);
  }

  @Delete(':id/attachments/:fileAssetId')
  @RequirePermissions('opening_stock:edit')
  @ApiOperation({ summary: 'Delete an attachment (draft only)' })
  deleteAttachment(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('fileAssetId') fileAssetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.attachments.remove(companyId, id, fileAssetId, user.sub);
  }

  @Get()
  @RequirePermissions('opening_stock:view')
  @ApiOperation({ summary: 'List opening stock documents' })
  list(
    @Param('companyId') companyId: string,
    @Query() query: InventoryDocumentListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.list(this.type, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('opening_stock:view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.findOne(this.type, companyId, id);
  }

  @Post()
  @RequirePermissions('opening_stock:create')
  @ApiOperation({ summary: 'Create opening stock draft (no stock change)' })
  create(@Param('companyId') companyId: string, @Body() dto: OpeningStockDto, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.create(this.type, companyId, dto, user.sub);
  }

  @Put(':id')
  @RequirePermissions('opening_stock:edit')
  @ApiOperation({ summary: 'Replace an opening stock draft' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: OpeningStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.update(this.type, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('opening_stock:delete')
  @ApiOperation({ summary: 'Delete an opening stock draft' })
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.remove(this.type, companyId, id, user.sub);
  }

  @Post(':id/post')
  @RequirePermissions('opening_stock:approve')
  @ApiOperation({ summary: 'Post opening stock: ledger IN + stock increase' })
  post(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.post(this.type, companyId, id, user.sub);
  }
}

@ApiTags('Inventory — Material Issue')
@ApiBearerAuth()
@Controller('companies/:companyId/inventory/material-issues')
export class MaterialIssuesController {
  private readonly type = InventoryDocumentType.MATERIAL_ISSUE;
  constructor(private readonly service: InventoryDocumentsService) {}

  @Get()
  @RequirePermissions('material_issues:view')
  @ApiOperation({ summary: 'List material issues' })
  list(
    @Param('companyId') companyId: string,
    @Query() query: InventoryDocumentListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.list(this.type, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('material_issues:view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.findOne(this.type, companyId, id);
  }

  @Post()
  @RequirePermissions('material_issues:create')
  @ApiOperation({ summary: 'Create material issue draft (no stock change)' })
  create(@Param('companyId') companyId: string, @Body() dto: MaterialIssueDto, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.create(this.type, companyId, dto, user.sub);
  }

  @Put(':id')
  @RequirePermissions('material_issues:edit')
  @ApiOperation({ summary: 'Replace a material issue draft' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: MaterialIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.update(this.type, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('material_issues:delete')
  @ApiOperation({ summary: 'Delete a material issue draft' })
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.remove(this.type, companyId, id, user.sub);
  }

  @Post(':id/post')
  @RequirePermissions('material_issues:approve')
  @ApiOperation({ summary: 'Post material issue: ledger OUT + stock decrease (rejects insufficient stock)' })
  post(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.post(this.type, companyId, id, user.sub);
  }
}

@ApiTags('Inventory — Stock Adjustment')
@ApiBearerAuth()
@Controller('companies/:companyId/inventory/stock-adjustments')
export class StockAdjustmentsController {
  private readonly type = InventoryDocumentType.STOCK_ADJUSTMENT;
  constructor(private readonly service: InventoryDocumentsService) {}

  @Get()
  @RequirePermissions('stock_adjustments:view')
  @ApiOperation({ summary: 'List stock adjustments' })
  list(
    @Param('companyId') companyId: string,
    @Query() query: InventoryDocumentListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.list(this.type, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('stock_adjustments:view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.findOne(this.type, companyId, id);
  }

  @Post()
  @RequirePermissions('stock_adjustments:create')
  @ApiOperation({ summary: 'Create stock adjustment draft (no stock change)' })
  create(@Param('companyId') companyId: string, @Body() dto: StockAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.create(this.type, companyId, dto, user.sub);
  }

  @Put(':id')
  @RequirePermissions('stock_adjustments:edit')
  @ApiOperation({ summary: 'Replace a stock adjustment draft' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: StockAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.update(this.type, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('stock_adjustments:delete')
  @ApiOperation({ summary: 'Delete a stock adjustment draft' })
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.remove(this.type, companyId, id, user.sub);
  }

  @Post(':id/post')
  @RequirePermissions('stock_adjustments:approve')
  @ApiOperation({ summary: 'Post stock adjustment: system qty re-read, ledger IN/OUT for the difference' })
  post(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.post(this.type, companyId, id, user.sub);
  }
}

@ApiTags('Inventory — Stock Transfer')
@ApiBearerAuth()
@Controller('companies/:companyId/inventory/stock-transfers')
export class StockTransfersController {
  private readonly type = InventoryDocumentType.STOCK_TRANSFER;
  constructor(private readonly service: InventoryDocumentsService) {}

  @Get()
  @RequirePermissions('stock_transfers:view')
  @ApiOperation({ summary: 'List same-store bin-to-bin stock transfers' })
  list(
    @Param('companyId') companyId: string,
    @Query() query: InventoryDocumentListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.list(this.type, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('stock_transfers:view')
  findOne(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.findOne(this.type, companyId, id);
  }

  @Post()
  @RequirePermissions('stock_transfers:create')
  @ApiOperation({ summary: 'Create stock transfer draft (no stock change)' })
  create(@Param('companyId') companyId: string, @Body() dto: StockTransferDto, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.create(this.type, companyId, dto, user.sub);
  }

  @Put(':id')
  @RequirePermissions('stock_transfers:edit')
  @ApiOperation({ summary: 'Replace a stock transfer draft' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: StockTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.service.update(this.type, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('stock_transfers:delete')
  @ApiOperation({ summary: 'Delete a stock transfer draft' })
  remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.remove(this.type, companyId, id, user.sub);
  }

  @Post(':id/post')
  @RequirePermissions('stock_transfers:approve')
  @ApiOperation({ summary: 'Post transfer: TRANSFER_OUT from bin + TRANSFER_IN to bin (same store)' })
  post(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertCompanyAccess(companyId, user);
    return this.service.post(this.type, companyId, id, user.sub);
  }
}
