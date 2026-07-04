import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { NotFoundException } from '@/common/exceptions/business.exception';
import { PermissionsService } from './permissions.service';

@ApiTags('Permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions('permissions:view')
  @ApiOperation({ summary: 'List all permissions' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.permissionsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('permissions:view')
  @ApiOperation({ summary: 'Get permission by ID' })
  async findOne(@Param('id') id: string) {
    const permission = await this.permissionsService.findOne(id);
    if (!permission) throw new NotFoundException('Permission');
    return permission;
  }
}
