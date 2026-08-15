import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AllowWhenMustChangePassword, Public } from '@/common/decorators/auth.decorators';
import { CurrentUser, CompanyId } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshTokenDto,
  ResolveCompanyDto,
  SwitchCompanyDto,
} from './dto/auth.dto';
import { REFRESH_COOKIE_OPTIONS, REFRESH_TOKEN_COOKIE } from './auth.constants';

function clientMeta(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

function readRefreshToken(req: Request, bodyToken?: string): string | undefined {
  return (req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined) ?? bodyToken;
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_COOKIE_OPTIONS.path });
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('company')
  @ApiOperation({ summary: 'Resolve company by code (pre-login)' })
  resolveCompany(@Query() query: ResolveCompanyDto) {
    return this.authService.getPublicCompanyByCode(query.companyCode);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login with employee code and password' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto, clientMeta(req));
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readRefreshToken(req, dto.refreshToken);
    const result = await this.authService.refresh(token ?? '', clientMeta(req));
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Get('me')
  @ApiBearerAuth()
  @AllowWhenMustChangePassword()
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: AuthenticatedUser, @CompanyId() companyId: string) {
    return this.authService.getMe(user.sub, companyId);
  }

  @Get('companies')
  @ApiBearerAuth()
  @AllowWhenMustChangePassword()
  @ApiOperation({ summary: 'List companies for current user' })
  getMyCompanies(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMyCompanies(user.sub);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @AllowWhenMustChangePassword()
  @ApiOperation({ summary: 'Change password (required after invite temp password)' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @CompanyId() companyId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.sub, companyId, dto);
  }

  @Post('logout')
  @ApiBearerAuth()
  @AllowWhenMustChangePassword()
  @ApiOperation({ summary: 'Logout and revoke session' })
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @CompanyId() companyId: string,
  ) {
    const token = readRefreshToken(req, dto.refreshToken);
    const result = await this.authService.logout(token, user.sub, companyId, user.sessionId);
    clearRefreshCookie(res);
    return result;
  }

  @Post('switch-company')
  @ApiBearerAuth()
  @AllowWhenMustChangePassword()
  @ApiOperation({ summary: 'Switch active company' })
  async switchCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SwitchCompanyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.switchCompany(
      user.sub,
      dto.companyId,
      clientMeta(req),
      user.sessionId,
    );
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }
}
