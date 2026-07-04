import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';
import { ApiKeysService } from './api-keys.service';

@ApiTags('User API Keys')
@ApiBearerAuth()
@Controller('users/:userId/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @RequirePermissions('api_keys:view')
  @ApiOperation({ summary: 'List API keys for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.apiKeysService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('api_keys:view')
  @ApiOperation({ summary: 'Get API key by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.apiKeysService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('api_keys:create')
  @ApiOperation({ summary: 'Create API key (secret returned once)' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiKeysService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('api_keys:edit')
  @ApiOperation({ summary: 'Update API key metadata or revoke' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateApiKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiKeysService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('api_keys:delete')
  @ApiOperation({ summary: 'Revoke API key' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiKeysService.remove(userId, companyId, id, user.sub);
  }
}
