import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  CreateSuperAdminDto,
  SuperAdminLoginDto,
  UpdateSuperAdminDto,
} from './dto/super-admin.dto';
import { SuperAdminAuthService, SuperAdminsService } from './super-admins.service';

@ApiTags('Super Admins')
@Controller('super-admins')
export class SuperAdminsController {
  constructor(
    private readonly superAdminsService: SuperAdminsService,
    private readonly superAdminAuthService: SuperAdminAuthService,
  ) {}

  @Public()
  @Post('bootstrap')
  @ApiOperation({ summary: 'Create first super admin (only when table is empty)' })
  bootstrap(@Body() dto: CreateSuperAdminDto) {
    return this.superAdminsService.bootstrap(dto);
  }

  @Public()
  @Post('auth/login')
  @ApiOperation({ summary: 'Super admin login' })
  login(@Body() dto: SuperAdminLoginDto) {
    return this.superAdminAuthService.login(dto);
  }

  @Get()
  @ApiBearerAuth()
  @RequirePermissions('super_admins:view')
  @ApiOperation({ summary: 'List super admins' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.superAdminsService.findAll(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequirePermissions('super_admins:view')
  @ApiOperation({ summary: 'Get super admin by ID' })
  findOne(@Param('id') id: string) {
    return this.superAdminsService.findOne(id);
  }

  @Post()
  @ApiBearerAuth()
  @RequirePermissions('super_admins:create')
  @ApiOperation({ summary: 'Create super admin' })
  create(@Body() dto: CreateSuperAdminDto, @CurrentUser() user: AuthenticatedUser) {
    return this.superAdminsService.create(dto, user.sub);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @RequirePermissions('super_admins:edit')
  @ApiOperation({ summary: 'Update super admin' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSuperAdminDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.superAdminsService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @RequirePermissions('super_admins:delete')
  @ApiOperation({ summary: 'Delete super admin' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.superAdminsService.remove(id, user.sub);
  }
}
