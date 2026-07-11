import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public, RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import {
  CreateSuperAdminDto,
  SuperAdminLoginDto,
  SuperAdminRefreshTokenDto,
  UpdateSuperAdminDto,
} from './dto/super-admin.dto';
import {
  SUPER_ADMIN_REFRESH_COOKIE_OPTIONS,
  SUPER_ADMIN_REFRESH_TOKEN_COOKIE,
} from './super-admins.constants';
import { SuperAdminAuthService, SuperAdminsService } from './super-admins.service';

function readSuperAdminRefreshToken(req: Request, bodyToken?: string): string | undefined {
  return (req.cookies?.[SUPER_ADMIN_REFRESH_TOKEN_COOKIE] as string | undefined) ?? bodyToken;
}

function setSuperAdminRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(SUPER_ADMIN_REFRESH_TOKEN_COOKIE, refreshToken, SUPER_ADMIN_REFRESH_COOKIE_OPTIONS);
}

function clearSuperAdminRefreshCookie(res: Response) {
  res.clearCookie(SUPER_ADMIN_REFRESH_TOKEN_COOKIE, {
    path: SUPER_ADMIN_REFRESH_COOKIE_OPTIONS.path,
  });
}

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
  @ApiOperation({ summary: 'Super admin login (email + password)' })
  async login(
    @Body() dto: SuperAdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.superAdminAuthService.login(dto);
    if (result.refreshToken) {
      setSuperAdminRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Public()
  @Post('auth/refresh')
  @ApiOperation({ summary: 'Refresh super admin access token' })
  async refresh(
    @Body() dto: SuperAdminRefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readSuperAdminRefreshToken(req, dto.refreshToken);
    const result = await this.superAdminAuthService.refresh(token ?? '');
    if (result.refreshToken) {
      setSuperAdminRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Get('auth/me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current super admin profile' })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.superAdminAuthService.getMe(user.sub);
  }

  @Post('auth/logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout super admin and revoke session' })
  async logout(
    @Body() dto: SuperAdminRefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const token = readSuperAdminRefreshToken(req, dto.refreshToken);
    const result = await this.superAdminAuthService.logout(token, user.sub, user.sessionId);
    clearSuperAdminRefreshCookie(res);
    return result;
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
