import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { RequireModulePermission } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { ITEM_ATTACHMENT_MAX_BYTES } from './item-attachments.constants';
import {
  CreateItemDto,
  UpdateItemDto,
  UpdateItemSettingsDto,
  UpsertItemWarehouseStockDto,
} from './dto/item.dto';
import { ItemsService } from './items.service';

type UploadedMulterFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@ApiTags('Item Master')
@ApiBearerAuth()
@Controller('companies/:companyId/items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @ApiOperation({ summary: 'List item master records' })
  @RequireModulePermission('supply-chain', 'view')
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.findAll(companyId, query, user.sub);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get Item Master code settings (AUTO/MANUAL)' })
  @RequireModulePermission('supply-chain', 'view')
  getSettings(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.getItemSettings(companyId, user.sub);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update Item Master code settings (AUTO/MANUAL)' })
  @RequireModulePermission('supply-chain', 'edit')
  updateSettings(
    @Param('companyId') companyId: string,
    @Body() dto: UpdateItemSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.updateItemSettings(companyId, dto, user.sub);
  }

  @Post()
  @ApiOperation({
    summary: 'Create item (AUTO generates itemCode; MANUAL requires itemCode)',
  })
  @RequireModulePermission('supply-chain', 'create')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.create(companyId, dto, user.sub);
  }

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Upload one or more item attachment files' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @RequireModulePermission('supply-chain', 'edit')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'files', maxCount: 20 },
        { name: 'file', maxCount: 20 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: ITEM_ATTACHMENT_MAX_BYTES },
      },
    ),
  )
  uploadAttachments(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @UploadedFiles()
    uploaded: { files?: UploadedMulterFile[]; file?: UploadedMulterFile[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    const files = [...(uploaded?.files ?? []), ...(uploaded?.file ?? [])];
    return this.itemsService.uploadAttachments(id, companyId, files, user.sub);
  }

  @Get(':id/attachments/:fileAssetId/url')
  @ApiOperation({ summary: 'Get signed download URL for an item attachment' })
  @RequireModulePermission('supply-chain', 'view')
  getAttachmentUrl(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('fileAssetId') fileAssetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.getAttachmentSignedUrl(id, companyId, fileAssetId);
  }

  @Delete(':id/attachments/:fileAssetId')
  @ApiOperation({ summary: 'Delete an uploaded item attachment' })
  @RequireModulePermission('supply-chain', 'edit')
  deleteAttachment(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('fileAssetId') fileAssetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.deleteAttachment(id, companyId, fileAssetId, user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one item with warehouse stock' })
  @RequireModulePermission('supply-chain', 'view')
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.findOne(id, companyId, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update item' })
  @RequireModulePermission('supply-chain', 'edit')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete item' })
  @RequireModulePermission('supply-chain', 'delete')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.remove(id, companyId, user.sub);
  }

  @Put(':id/warehouses')
  @ApiOperation({ summary: 'Create or update item stock row for a warehouse' })
  @RequireModulePermission('supply-chain', 'edit')
  upsertWarehouseStock(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpsertItemWarehouseStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.upsertWarehouseStock(id, companyId, dto, user.sub);
  }

  @Delete(':id/warehouses/:warehouseId')
  @ApiOperation({ summary: 'Remove item stock row for a warehouse' })
  @RequireModulePermission('supply-chain', 'delete')
  removeWarehouseStock(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.itemsService.removeWarehouseStock(id, companyId, warehouseId, user.sub);
  }
}
