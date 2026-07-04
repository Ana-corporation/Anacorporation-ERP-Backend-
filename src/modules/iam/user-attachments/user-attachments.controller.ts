import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserAttachmentDto, UpdateUserAttachmentDto } from './dto/user-attachment.dto';
import { UserAttachmentsService } from './user-attachments.service';

@ApiTags('User Attachments')
@ApiBearerAuth()
@Controller('users/:userId/attachments')
export class UserAttachmentsController {
  constructor(private readonly userAttachmentsService: UserAttachmentsService) {}

  @Get()
  @RequirePermissions('user_attachments:view')
  @ApiOperation({ summary: 'List attachments for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userAttachmentsService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_attachments:view')
  @ApiOperation({ summary: 'Get user attachment by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userAttachmentsService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_attachments:create')
  @ApiOperation({ summary: 'Register a user document attachment' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userAttachmentsService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_attachments:edit')
  @ApiOperation({ summary: 'Update attachment metadata or verification status' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userAttachmentsService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_attachments:delete')
  @ApiOperation({ summary: 'Delete user attachment' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userAttachmentsService.remove(userId, companyId, id, user.sub);
  }
}
