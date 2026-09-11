import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { UserAuditAction } from '@prisma/client';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { BusinessException } from '@/common/exceptions/business.exception';
import { AuthService } from '@/modules/iam/authentication/auth.service';
import { UserContextCacheService } from '@/modules/iam/authentication/user-context-cache.service';
import { UserPreferencesRepository } from '@/modules/iam/user-preferences/user-preferences.repository';
import {
  PatchSelfProfileDto,
  PatchSelfSettingsDto,
  rejectForbiddenSelfPatchKeys,
} from './dto/user-me.dto';
import { UsersRepository } from './users.repository';
import {
  USER_AVATAR_MAX_BYTES,
  avatarLooksLikeMime,
  resolveAvatarMime,
} from './user-avatar.constants';

type UploadedMulterFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class UsersMeService {
  private readonly logger = new Logger(UsersMeService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly repository: UsersRepository,
    private readonly storageService: StorageService,
    private readonly preferences: UserPreferencesRepository,
    private readonly userContextCache: UserContextCacheService,
    private readonly auditService: AuditService,
  ) {}

  getProfile(userId: string, companyId: string) {
    return this.authService.getMyProfile(userId, companyId);
  }

  async patchProfile(
    userId: string,
    companyId: string,
    dto: PatchSelfProfileDto,
    rawBody: Record<string, unknown>,
  ) {
    rejectForbiddenSelfPatchKeys(rawBody);
    await this.repository.updateSelfProfile(
      userId,
      {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.phone !== undefined ? { mobile: dto.phone } : {}),
      },
      userId,
    );
    await this.userContextCache.invalidate(userId, companyId);
    await this.auditService.log({
      companyId,
      userId,
      performedBy: userId,
      action: UserAuditAction.update,
      entityName: 'User',
      entityId: userId,
      newValue: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      },
    });
    return this.getProfile(userId, companyId);
  }

  async uploadAvatar(userId: string, companyId: string, file?: UploadedMulterFile) {
    if (!file?.buffer?.length) {
      throw new BusinessException('Avatar file is required', HttpStatus.BAD_REQUEST, [
        { field: 'file', message: 'Upload an image file' },
      ]);
    }
    if (file.size > USER_AVATAR_MAX_BYTES) {
      throw new BusinessException('Avatar must be 2 MB or smaller', HttpStatus.BAD_REQUEST, [
        { field: 'file', message: 'Max size is 2 MB' },
      ]);
    }

    const mimeType = resolveAvatarMime(file.originalname, file.mimetype);
    if (!mimeType || !avatarLooksLikeMime(file.buffer, mimeType)) {
      throw new BusinessException(
        'Avatar must be a jpeg, png, or webp image',
        HttpStatus.BAD_REQUEST,
        [{ field: 'file', message: 'Only jpeg, png, and webp are allowed' }],
      );
    }

    let avatarUrl: string;
    try {
      const asset = await this.storageService.uploadFile({
        organizationId: companyId,
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType,
        uploadedById: userId,
        entityType: 'user-avatar',
        entityId: userId,
      });
      avatarUrl = asset.publicUrl || (await this.storageService.getSignedUrl(companyId, asset.id)) || '';
    } catch (error) {
      this.logger.error(
        'Avatar upload failed',
        error instanceof Error ? error.stack : error,
      );
      throw new BusinessException('File upload failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    if (!avatarUrl) {
      throw new BusinessException('File upload failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    await this.repository.updateProfilePhoto(userId, avatarUrl, userId);
    await this.userContextCache.invalidate(userId, companyId);
    await this.auditService.log({
      companyId,
      userId,
      performedBy: userId,
      action: UserAuditAction.update,
      entityName: 'User',
      entityId: userId,
      newValue: { avatarUrl },
    });

    return { avatarUrl };
  }

  async patchSettings(userId: string, companyId: string, dto: PatchSelfSettingsDto) {
    const existing = await this.preferences.findByUserAndCompany(userId, companyId);
    const language = dto.locale;
    const dateFormat = dto.dateFormat;

    if (existing) {
      await this.preferences.update(existing.preferenceId.toString(), {
        ...(language !== undefined ? { language } : {}),
        ...(dateFormat !== undefined ? { dateFormat } : {}),
      });
    } else {
      await this.preferences.create({
        userId,
        companyId,
        theme: 'light',
        language: language ?? 'en',
        dateFormat: dateFormat ?? 'yyyy-MM-dd',
        timeFormat: 'HH:mm',
      });
    }

    const saved = await this.preferences.findByUserAndCompany(userId, companyId);
    await this.auditService.log({
      companyId,
      userId,
      performedBy: userId,
      action: UserAuditAction.update,
      entityName: 'UserPreference',
      entityId: saved?.preferenceId.toString(),
      newValue: { locale: dto.locale, dateFormat: dto.dateFormat },
    });

    return {
      locale: saved?.language ?? language ?? 'en',
      dateFormat: saved?.dateFormat ?? dateFormat ?? 'yyyy-MM-dd',
    };
  }
}
