import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { AllowWhenMustChangePassword } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { PatchSelfProfileDto, PatchSelfSettingsDto } from './dto/user-me.dto';
import { USER_AVATAR_MAX_BYTES } from './user-avatar.constants';
import { UsersMeService } from './users-me.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users/me')
export class UsersMeController {
  constructor(private readonly usersMeService: UsersMeService) {}

  @Get()
  @AllowWhenMustChangePassword()
  @ApiOperation({ summary: 'Get the logged-in user profile for the active company' })
  getMe(@CurrentUser() user: AuthenticatedUser, @CompanyId() companyId: string) {
    return this.usersMeService.getProfile(user.sub, companyId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update own display name and phone' })
  patchMe(
    @CurrentUser() user: AuthenticatedUser,
    @CompanyId() companyId: string,
    @Body() dto: PatchSelfProfileDto,
    @Req() req: Request,
  ) {
    return this.usersMeService.patchProfile(
      user.sub,
      companyId,
      dto,
      (req.body ?? {}) as Record<string, unknown>,
    );
  }

  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Upload own profile photo' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: USER_AVATAR_MAX_BYTES },
    }),
  )
  uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @CompanyId() companyId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersMeService.uploadAvatar(user.sub, companyId, file);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update own locale and date format' })
  patchSettings(
    @CurrentUser() user: AuthenticatedUser,
    @CompanyId() companyId: string,
    @Body() dto: PatchSelfSettingsDto,
  ) {
    return this.usersMeService.patchSettings(user.sub, companyId, dto);
  }
}
