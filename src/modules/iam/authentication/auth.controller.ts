import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/auth.decorators';
import { CurrentUser, CompanyId } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, SignUpDto, SwitchCompanyDto } from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Sign up — create user and company' })
  signUp(@Body() dto: SignUpDto) {
    return this.authService.signUp(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: AuthenticatedUser, @CompanyId() companyId: string) {
    return this.authService.getMe(user.sub, companyId);
  }

  @Get('companies')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List companies for current user' })
  getMyCompanies(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMyCompanies(user.sub);
  }

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke session' })
  logout(@Body() dto: RefreshTokenDto, @CurrentUser() user: AuthenticatedUser, @CompanyId() companyId: string) {
    return this.authService.logout(dto.refreshToken, user.sub, companyId);
  }

  @Post('switch-company')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Switch active company' })
  switchCompany(@CurrentUser() user: AuthenticatedUser, @Body() dto: SwitchCompanyDto) {
    return this.authService.switchCompany(user.sub, dto.companyId);
  }
}
