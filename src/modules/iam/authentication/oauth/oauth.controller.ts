import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '@/common/decorators/auth.decorators';
import { REFRESH_COOKIE_OPTIONS, REFRESH_TOKEN_COOKIE } from '../auth.constants';
import { OAuthCallbackDto, OAuthExchangeDto, OAuthStartDto } from './oauth.dto';
import { OAuthService } from './oauth.service';

function clientMeta(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
}

@ApiTags('Auth — OAuth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Start Google OAuth login (redirects to Google)' })
  startGoogle(@Query() query: OAuthStartDto, @Res() res: Response) {
    const { authorizationUrl } = this.oauthService.getAuthorizationUrl(
      'google',
      query.companyCode,
      query.redirectUri,
    );
    return res.redirect(authorizationUrl);
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Query() query: OAuthCallbackDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.oauthService.handleCallback(
      'google',
      query.code,
      query.state,
      clientMeta(req),
    );
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Public()
  @Post('google/token')
  @ApiOperation({ summary: 'Exchange Google OAuth code (SPA/mobile flow)' })
  async googleToken(
    @Body() dto: OAuthExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.oauthService.exchangeCode(
      'google',
      dto.code,
      dto.companyCode,
      dto.redirectUri,
      clientMeta(req),
    );
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Public()
  @Get('microsoft')
  @ApiOperation({ summary: 'Start Microsoft (Outlook) OAuth login' })
  startMicrosoft(@Query() query: OAuthStartDto, @Res() res: Response) {
    const { authorizationUrl } = this.oauthService.getAuthorizationUrl(
      'microsoft',
      query.companyCode,
      query.redirectUri,
    );
    return res.redirect(authorizationUrl);
  }

  @Public()
  @Get('microsoft/callback')
  @ApiOperation({ summary: 'Microsoft OAuth callback' })
  async microsoftCallback(
    @Query() query: OAuthCallbackDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.oauthService.handleCallback(
      'microsoft',
      query.code,
      query.state,
      clientMeta(req),
    );
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Public()
  @Post('microsoft/token')
  @ApiOperation({ summary: 'Exchange Microsoft OAuth code (SPA/mobile flow)' })
  async microsoftToken(
    @Body() dto: OAuthExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.oauthService.exchangeCode(
      'microsoft',
      dto.code,
      dto.companyCode,
      dto.redirectUri,
      clientMeta(req),
    );
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken: _rt, ...body } = result;
    return body;
  }
}
